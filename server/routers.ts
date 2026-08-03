import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { checkSalesRateLimit, SALES_MAX_MESSAGES, SALES_MAX_CHARS } from "./salesAgent";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";
import { agentRouter } from "./routers/agent";
import { paymentsRouter } from "./routers/payments";
import { pingOpenAI, pingErpNext, pingOpenRouter } from "./llmProvider";
import { getErpConfigForUser, getErpSession, invalidateErpSession, testConnectionByProvider, encryptPassword } from "./erpConnection";
import { loginWithErpAccount, signupWithErpAccount, activateTrialIfExpired, loginWithStoredConnection } from "./erpAuth";
import {
  getOrganizationForUser, listOrgMembers, inviteSubUser,
  updateMemberPermissions, removeMember, loginSubUserWithPassword,
  requireMemberPermission,
} from "./organizations";
import { notifyUser, notifyAdmins, maybeNotifyTrialEnding } from "./notifications";
import { notificationsRouter } from "./routers/notificationsRouter";
import { sdk } from "./_core/sdk";
import { erpnextConnections } from "../drizzle/schema";
import { eq, and, ne } from "drizzle-orm";
import {
  getActivePlans, getPlanById,
  getSubscriptionByUserId, createSubscription, updateSubscription,
  getTasksByUserId, createTask, updateTask,
  getInvoicesByUserId,
  createRegistrationRequest,
  getAllRegistrationRequests, getAllSubscriptions, getAllTasks,
  getTaskCommentsByTaskId, createTaskComment, getTaskById,
  updateUserProfile,
  getAllUsers, setUserRole,
  setUserActive, getUserById,
} from "./db";

// ─── ERPNext Per-User Fetch ───────────────────────────────────────────────────
// كل مستخدم يتصل بنظامه الخاص (من إعداداته) أو باتصال النظام الافتراضي
async function erpFetch(path: string, userId: number): Promise<unknown> {
  const config = await getErpConfigForUser(userId);
  const sid = await getErpSession(config);
  const res = await fetch(`${config.url}${path}`, {
    headers: { Cookie: `sid=${sid}` },
  });
  if (!res.ok) {
    // If unauthorized, clear cached session and retry once
    if (res.status === 403 || res.status === 401) {
      invalidateErpSession(config);
      const sid2 = await getErpSession(config);
      const res2 = await fetch(`${config.url}${path}`, {
        headers: { Cookie: `sid=${sid2}` },
      });
      if (!res2.ok) {
        const errText = await res2.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext API error ${res2.status}: ${errText.slice(0, 200)}` });
      }
      return res2.json();
    }
    const errText = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext API error ${res.status}: ${errText.slice(0, 200)}` });
  }
  return res.json();
}

// ─── سياسة تسجيل الدخول: تفعيل الحساب بالبريد + رمز التحقق (OTP) ─────────────
// كلاهما مُفعّل افتراضياً، ويمكن إيقافه صراحةً بـ =false في البيئة.
// **مبدأ مهم: fail-open** — إن تعذّر إرسال البريد (مزوّد غير مضبوط أو رفض المستلم)
// لا نحبس العميل خارج حسابه، بل نسجّل تحذيراً ونكمل الدخول. البديل (fail-closed)
// يعني قفل كل العملاء لحظة تعطّل البريد، وهذا أسوأ من تخطّي الخطوة مؤقتاً.
function flagEnabled(name: string): boolean {
  return (process.env[name] ?? "true").toLowerCase() !== "false";
}

type LoginUser = { id: number; openId: string; name: string | null; email: string | null; emailVerifiedAt: Date | null };

async function loadLoginUser(openId: string): Promise<LoginUser | null> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) return null;
  const { users: u } = await import("../drizzle/schema");
  const rows = await db.select({
    id: u.id, openId: u.openId, name: u.name, email: u.email, emailVerifiedAt: u.emailVerifiedAt,
  }).from(u).where(eq(u.openId, openId)).limit(1);
  return rows[0] ?? null;
}

function issueSession(ctx: { req: unknown; res: { cookie: (n: string, v: string, o: Record<string, unknown>) => void } }, token: string) {
  const cookieOptions = getSessionCookieOptions(ctx.req as never);
  ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
}

/**
 * تُستدعى بعد نجاح بيانات الدخول. ترجع إما جلسة جاهزة، أو طلب رمز تحقق.
 * ترمي FORBIDDEN إن كان الحساب غير مُفعَّل (بريد غير مؤكد) والبريد يعمل فعلاً.
 */
async function completeLogin(
  ctx: { req: unknown; res: { cookie: (n: string, v: string, o: Record<string, unknown>) => void } },
  openId: string,
  fullName: string,
): Promise<{ success: true; name: string; email: string | null; otpRequired?: false }
         | { success: true; otpRequired: true; challengeId: string; maskedEmail: string; name?: undefined; email?: undefined }> {
  const user = await loadLoginUser(openId);
  const flows = await import("./emailFlows");
  const { isEmailConfigured } = await import("./email");

  // 1) تفعيل الحساب: يجب تأكيد البريد قبل الاستخدام
  if (user && !user.emailVerifiedAt && flagEnabled("REQUIRE_EMAIL_VERIFICATION")) {
    const sent = await flows.sendVerificationEmail(user.id).catch(() => ({ ok: false as const, reason: "خطأ غير متوقع" }));
    if (sent.ok) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `حسابك غير مُفعَّل بعد. أرسلنا رابط التفعيل إلى ${user.email ? flows.maskEmail(user.email) : "بريدك"} — أكّد بريدك ثم سجّل الدخول.`,
      });
    }
    // البريد لا يعمل → لا نحبس العميل
    console.warn(`[login] email verification gate skipped for user ${user.id}: ${sent.reason}`);
  }

  // 2) رمز التحقق عند تسجيل الدخول
  if (user && flagEnabled("REQUIRE_LOGIN_OTP") && isEmailConfigured()) {
    const otp = await flows.createAndSendLoginOtp(user.id).catch(() => ({ ok: false as const, reason: "خطأ غير متوقع" }));
    if (otp.ok) {
      return { success: true, otpRequired: true, challengeId: otp.challengeId, maskedEmail: otp.maskedEmail };
    }
    console.warn(`[login] OTP step skipped for user ${user.id}: ${otp.reason}`);
  }

  const token = await sdk.createSessionToken(openId, { name: fullName });
  issueSession(ctx, token);
  return { success: true, name: fullName, email: user?.email ?? null };
}

/**
 * يوحّد رابط نظام العميل: يضيف https إن غاب، ويزيل المسار والشرطة الأخيرة.
 * من يكتب "company.erpnext.com" لم يخطئ خطأً يستحق الرفض، ومن ينسخ الرابط من
 * المتصفح يأتي معه مسار — والاثنان كانا يُردّان برسالة تختفي خلف القائمة.
 */
function normalizeErpUrl(raw: string): string | null {
  let v = raw.trim().replace(/\s+/g, "");
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

export const appRouter = router({
  system: systemRouter,
  // ─── تشخيص خفيف لمزود النموذج (لا يكشف الأسرار) ──────────────────────────
  diagnostics: router({
    openaiPing: publicProcedure.query(() => pingOpenAI()),
    openrouterPing: publicProcedure.query(() => pingOpenRouter()),
    erpPing: publicProcedure.query(() => pingErpNext()),
  }),
  // ─── إعدادات اتصال نظام ERP لكل منظمة (ERPNext أو Odoo) ───────────────────
  erpConnection: router({
    // حالة الربط كما هي الآن — لا كما كانت وقت الحفظ.
    //
    // **لماذا اختبارٌ حيّ لا حقلٌ محفوظ:** `lastVerifiedAt` يُكتب مرّة عند
    // الحفظ ولا يُعاد أبداً، وكلمة السرّ تتغيّر على الطرف الآخر بلا خبر. عميلٌ
    // حقيقي أمضى جلسة كاملة يحاول والوكيل يرفض، ولوحته تقول «مربوط».
    //
    // ويُخزَّن الناتج دقيقتين: الشاشات تسأل عنه كثيراً، ونداء تسجيل دخول مع كل
    // سؤال يُثقل نظام العميل بلا فائدة.
    status: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.effectiveUserId) {
        return { configured: false, ok: false, reason: "لا مستخدم", checkedAt: new Date().toISOString() };
      }

      const { getConnectionStatus } = await import("./erpHealth");
      return getConnectionStatus(ctx.effectiveUserId);
    }),
    get: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db || !ctx.effectiveUserId) return null;
      const rows = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, ctx.effectiveUserId)).limit(1);
      const conn = rows[0];
      if (!conn) return null;
      // لا نرجع كلمة المرور أبداً
      return { provider: conn.provider, url: conn.url, username: conn.username, database: conn.database, lastVerifiedAt: conn.lastVerifiedAt, updatedAt: conn.updatedAt };
    }),
    save: protectedProcedure
      .input(z.object({
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
        // نصلح الرابط لا نرفضه: من يكتب النطاق وحده لم يخطئ، والرفض هنا كان
        // يظهر كأن الزر لا يعمل
        url: z.string().trim().min(4, "أدخل رابط نظامك"),
        username: z.string().trim().min(1, "اسم المستخدم مطلوب"),
        password: z.string().min(1, "كلمة المرور مطلوبة"),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireMemberPermission(ctx.user, "manageErpSettings");
        const cleanUrl = normalizeErpUrl(input.url);
        if (!cleanUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "رابط غير صالح — مثال: https://company.erpnext.com" });
        // اختبار الاتصال قبل الحفظ
        const test = await testConnectionByProvider(input.provider, cleanUrl, input.username, input.password, input.database);
        if (!test.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: test.error ?? "فشل اختبار الاتصال" });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db || !ctx.effectiveUserId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const existing = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, ctx.effectiveUserId)).limit(1);
        const values = {
          provider: input.provider,
          url: cleanUrl,
          username: input.username,
          passwordEnc: encryptPassword(input.password),
          database: input.database ?? null,
          lastVerifiedAt: new Date(),
        };
        if (existing[0]) {
          await db.update(erpnextConnections).set(values).where(eq(erpnextConnections.userId, ctx.effectiveUserId));
        } else {
          await db.insert(erpnextConnections).values({ ...values, userId: ctx.effectiveUserId });
        }
        return { success: true, loggedInAs: test.loggedInAs };
      }),
    test: protectedProcedure
      .input(z.object({
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
        url: z.string().trim().min(4),
        username: z.string().trim().min(1),
        password: z.string().min(1),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input }) => {
        const url = normalizeErpUrl(input.url);
        if (!url) return { ok: false as const, error: "رابط غير صالح — مثال: https://company.erpnext.com" };
        return testConnectionByProvider(input.provider, url, input.username, input.password, input.database);
      }),
    remove: protectedProcedure.mutation(async ({ ctx }) => {
      requireMemberPermission(ctx.user, "manageErpSettings");
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db || !ctx.effectiveUserId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      await db.delete(erpnextConnections).where(eq(erpnextConnections.userId, ctx.effectiveUserId));
      return { success: true };
    }),
  }),
  // ─── تأكيد البريد الإلكتروني ────────────────────────────────────────────────
  email: router({
    /** حالة البريد الحالية للمستخدم (مؤكَّد؟ الإشعارات مفعّلة؟) */
    status: protectedProcedure.query(async ({ ctx }) => {
      const { isEmailConfigured } = await import("./email");
      return {
        email: ctx.user.email ?? null,
        verified: !!ctx.user.emailVerifiedAt,
        notificationsEnabled: ctx.user.emailNotifications !== false,
        emailServiceConfigured: isEmailConfigured(),
      };
    }),
    /** إرسال (أو إعادة إرسال) رابط التأكيد */
    sendVerification: protectedProcedure.mutation(async ({ ctx }) => {
      const { sendVerificationEmail } = await import("./emailFlows");
      const res = await sendVerificationEmail(ctx.user.id);
      if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.reason ?? "تعذّر إرسال رسالة التأكيد" });
      return { success: true };
    }),
    /** تأكيد البريد بالتوكن القادم من الرابط (عام — المستخدم قد لا يكون مسجّل الدخول) */
    verify: publicProcedure
      .input(z.object({ token: z.string().min(10).max(200) }))
      .mutation(async ({ input }) => {
        const { verifyEmailToken } = await import("./emailFlows");
        const res = await verifyEmailToken(input.token);
        if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.reason });
        return { success: true, email: res.email };
      }),
    /** تفعيل/إيقاف إشعارات البريد */
    setNotifications: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const { users: usersTable } = await import("../drizzle/schema");
        await db.update(usersTable).set({ emailNotifications: input.enabled }).where(eq(usersTable.id, ctx.user.id));
        return { success: true };
      }),
  }),
  /**
   * حالة إعداد الحساب — تقود القسم الثابت في لوحة العميل.
   * يبقى ظاهراً حتى تكتمل الخطوات الأساسية حتى لا يُنسى الربط أو تأكيد الجوال.
   */
  accountSetup: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      const { maskPhone } = await import("./phone");

      let erpConnected = false;
      let phone: string | null = null;
      let phoneVerified = false;
      let emailVerified = false;

      if (db) {
        const { erpnextConnections: conns, users: usersTable } = await import("../drizzle/schema");
        const [connRows, userRows] = await Promise.all([
          db.select({ id: conns.id }).from(conns).where(eq(conns.userId, ctx.user.id)).limit(1),
          db.select({ phone: usersTable.phone, phoneVerifiedAt: usersTable.phoneVerifiedAt, emailVerifiedAt: usersTable.emailVerifiedAt })
            .from(usersTable).where(eq(usersTable.id, ctx.user.id)).limit(1),
        ]);
        erpConnected = connRows.length > 0;
        phone = userRows[0]?.phone ?? null;
        phoneVerified = userRows[0]?.phoneVerifiedAt != null;
        emailVerified = userRows[0]?.emailVerifiedAt != null;
      }

      const steps = [
        {
          key: "erp" as const,
          done: erpConnected,
          title: "اربط نظامك المحاسبي",
          detail: "حتى يعمل المحاسب الذكي على بياناتك الحقيقية بدل البيانات التجريبية.",
          href: "/channels",
          cta: "اربط الآن",
          critical: true,
        },
        {
          key: "phone" as const,
          done: phoneVerified,
          title: "أكّد رقم جوالك",
          detail: phone ? `أرسلنا رمزاً إلى ${maskPhone(phone)}` : "أضف رقم جوالك لتأمين حسابك واستقبال التنبيهات المهمة.",
          href: "/settings",
          cta: phone ? "أكّد الرقم" : "أضف رقمك",
          critical: true,
        },
        {
          key: "email" as const,
          done: emailVerified,
          title: "أكّد بريدك الإلكتروني",
          detail: "لاستقبال الفواتير وتنبيهات التجديد.",
          href: "/settings",
          cta: "أكّد البريد",
          critical: false,
        },
      ];

      const remaining = steps.filter(s => !s.done);
      return {
        steps,
        remaining: remaining.length,
        // القسم لا يختفي ما دامت خطوة أساسية ناقصة
        showBanner: remaining.some(s => s.critical),
        phone,
        phoneMasked: phone ? maskPhone(phone) : null,
      };
    }),
  }),

  phone: router({
    /** يعتمد رقم الجوال بعد أن يثبت المتصفح ملكيته عبر Firebase */
    confirm: protectedProcedure
      .input(z.object({ idToken: z.string().min(20).max(4000) }))
      .mutation(async ({ input, ctx }) => {
        const { verifyFirebasePhoneToken } = await import("./firebasePhone");
        const { normalizePhone } = await import("./phone");

        const res = await verifyFirebasePhoneToken(input.idToken);
        if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.error });

        const norm = normalizePhone(res.phone);
        if (!norm.ok) throw new TRPCError({ code: "BAD_REQUEST", message: norm.error });

        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const { users: usersTable } = await import("../drizzle/schema");

        // رقم واحد لا يخدم حسابين: وإلا صار تأكيد الجوال بلا معنى
        const taken = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.phone, norm.e164), ne(usersTable.id, ctx.user.id))).limit(1);
        if (taken.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "هذا الرقم مرتبط بحساب آخر بالفعل" });
        }

        await db.update(usersTable)
          .set({ phone: norm.e164, phoneVerifiedAt: new Date() })
          .where(eq(usersTable.id, ctx.user.id));

        return { success: true, phone: norm.e164 } as const;
      }),

    /** يحفظ الرقم قبل التأكيد حتى لا يضيع إن تعذّرت الخدمة (التأكيد مؤجَّل لا متخطّى) */
    save: protectedProcedure
      .input(z.object({ phone: z.string().min(6).max(24) }))
      .mutation(async ({ input, ctx }) => {
        const { normalizePhone } = await import("./phone");
        const norm = normalizePhone(input.phone);
        if (!norm.ok) throw new TRPCError({ code: "BAD_REQUEST", message: norm.error });

        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const { users: usersTable } = await import("../drizzle/schema");

        const taken = await db.select({ id: usersTable.id }).from(usersTable)
          .where(and(eq(usersTable.phone, norm.e164), ne(usersTable.id, ctx.user.id))).limit(1);
        if (taken.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "هذا الرقم مرتبط بحساب آخر بالفعل" });
        }

        // تغيير الرقم يُلغي أي تأكيد سابق
        await db.update(usersTable)
          .set({ phone: norm.e164, phoneVerifiedAt: null })
          .where(eq(usersTable.id, ctx.user.id));
        return { success: true, phone: norm.e164, national: norm.national } as const;
      }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ?? null),

    /**
     * "نسيت كلمة المرور": يرسل رمزاً للبريد المسجَّل ليدخل به المستخدم بدون كلمة مرور.
     *
     * مالك الحساب يسجّل دخوله ببيانات ERPNext/Odoo التي لا نملكها ولا نستطيع
     * تغييرها، فالدخول بالرمز هو مسار الاستعادة الوحيد الممكن له.
     *
     * لا نكشف أبداً ما إذا كان البريد مسجّلاً عندنا أم لا: الرد واحد في الحالتين
     * (رمز تحدٍّ وهمي عند عدم وجود الحساب)، وإلا صارت الصفحة أداة لحصر عملائنا.
     */
    requestLoginOtp: publicProcedure
      .input(z.object({ email: z.string().trim().min(3).max(320) }))
      .mutation(async ({ input, ctx }) => {
        const { rateLimit, clientIp } = await import("./rateLimit");
        const { isEmailConfigured } = await import("./email");
        const { createAndSendLoginOtp, maskEmail } = await import("./emailFlows");

        const email = input.email.trim().toLowerCase();
        const ip = clientIp(ctx.req);

        const perEmail = rateLimit(`otp-req:email:${email}`, 3, 15 * 60 * 1000);
        const perIp = rateLimit(`otp-req:ip:${ip}`, 10, 15 * 60 * 1000);
        const limited = !perEmail.ok ? perEmail : !perIp.ok ? perIp : null;
        if (limited) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `طلبات كثيرة. حاول مجدداً بعد ${Math.ceil(limited.retryAfterSec / 60)} دقيقة.`,
          });
        }

        // انقطاع خدمة البريد عطل تشغيلي، لا يكشف شيئاً عن الحساب — نصرّح به
        if (!isEmailConfigured()) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "خدمة البريد غير مضبوطة حالياً — تواصل مع الدعم" });
        }

        const crypto = await import("node:crypto");
        const decoy = () => ({ challengeId: crypto.randomBytes(24).toString("hex"), maskedEmail: maskEmail(email) });

        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) return decoy();
        const { users: usersTable } = await import("../drizzle/schema");
        const found = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
        const user = found[0];
        if (!user || !user.isActive) return decoy();

        const sent = await createAndSendLoginOtp(user.id);
        if (!sent.ok) {
          console.warn(`[requestLoginOtp] send failed for user ${user.id}: ${sent.reason}`);
          return decoy();
        }
        return { challengeId: sent.challengeId, maskedEmail: sent.maskedEmail };
      }),

    /**
     * تعيين كلمة مرور محلية جديدة بعد الدخول بالرمز.
     * متاح للمستخدمين الفرعيين فقط: مالك الحساب كلمة مروره في نظام ERP نفسه،
     * وتغييرها من هنا سيوهمه أنه استعادها بينما لا شيء تغيّر فعلياً.
     */
    setLocalPassword: protectedProcedure
      .input(z.object({ password: z.string().min(8, "كلمة المرور 8 أحرف على الأقل").max(256) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.orgRole !== "member") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "حسابك يسجّل الدخول ببيانات نظام ERP الخاص بك، ولا نملك كلمة مروره. غيّرها من نظام ERPNext أو Odoo مباشرة.",
          });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const { hashPassword } = await import("./password");
        const { users: usersTable } = await import("../drizzle/schema");
        await db.update(usersTable).set({ passwordHash: hashPassword(input.password) }).where(eq(usersTable.id, ctx.user.id));
        return { success: true };
      }),

    /** الخطوة الثانية من تسجيل الدخول: التحقق من رمز البريد وإصدار الجلسة */
    verifyLoginOtp: publicProcedure
      .input(z.object({
        challengeId: z.string().min(10).max(80),
        code: z.string().trim().min(4).max(10),
      }))
      .mutation(async ({ input, ctx }) => {
        const { verifyLoginOtp } = await import("./emailFlows");
        const res = await verifyLoginOtp(input.challengeId, input.code);
        if (!res.ok) throw new TRPCError({ code: "UNAUTHORIZED", message: res.reason });

        const { getUserById: getUser } = await import("./db");
        const user = await getUser(res.userId);
        if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "الحساب غير موجود" });

        const token = await sdk.createSessionToken(user.openId, { name: user.name ?? "" });
        issueSession(ctx, token);
        return { success: true, name: user.name, email: user.email } as const;
      }),
    // تسجيل دخول مستخدم فرعي (بكلمة مرور محلية — لا يملك حساب ERPNext خاص به)
    loginMember: publicProcedure
      .input(z.object({
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await loginSubUserWithPassword(input.email, input.password);
        if (!result.ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: result.error });
        }
        return completeLogin(ctx, result.user.openId, result.user.name ?? "");
      }),
    // تسجيل الدخول بحساب ERP (ERPNext أو Odoo) — نفس بريد وكلمة مرور النظام.
    // لا نطلب رابط النظام مجدداً: نبحث عن اتصال ERP المحفوظ للمستخدم من التسجيل ونتحقق مقابله مباشرة.
    loginWithErp: publicProcedure
      .input(z.object({
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
        erpUrl: z.string().trim().max(500).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = input.erpUrl
          ? await loginWithErpAccount(input.erpUrl.replace(/\/+$/, ""), input.email, input.password)
          : await loginWithStoredConnection(input.email, input.password);
        if (!result.ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: result.error });
        }
        return completeLogin(ctx, result.result.openId, result.result.fullName);
      }),
    // فحص بيانات ERPNext أو Odoo مبكراً أثناء التسجيل (قبل اختيار الباقة) — رد فعل أسرع للمستخدم
    testErpCredentials: publicProcedure
      .input(z.object({
        erpUrl: z.string().trim().min(8).max(500),
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await testConnectionByProvider(input.provider, input.erpUrl, input.email, input.password, input.database);
        return result.ok ? { ok: true as const, fullName: result.loggedInAs ?? input.email } : { ok: false as const, error: result.error ?? "تعذّر التحقق من الحساب" };
      }),
    // تسجيل مستخدم جديد: رابط نظامه + بريده + كلمة مروره + الباقة، مع تجربة 3 أيام
    signupWithErp: publicProcedure
      .input(z.object({
        erpUrl: z.string().trim().min(8).max(500),
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
        planId: z.number().int().positive(),
        companyName: z.string().trim().max(255).optional(),
        phone: z.string().trim().min(6).max(24),
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // نوحّد الرقم هنا لا في الواجهة: أي عميل يستدعي الـAPI مباشرة يمر بنفس القاعدة
        const { normalizePhone } = await import("./phone");
        const normPhone = normalizePhone(input.phone);
        if (!normPhone.ok) throw new TRPCError({ code: "BAD_REQUEST", message: normPhone.error });
        const result = await signupWithErpAccount({ ...input, phone: normPhone.e164 });
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }
        const sessionToken = await sdk.createSessionToken(result.result.openId, {
          name: result.result.fullName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        // إشعار الأدمن بتسجيل مستخدم جديد (داخل الموقع + push)
        notifyAdmins({
          type: "new_user",
          title: "مستخدم جديد سجّل في المنصة",
          body: `${result.result.fullName} (${result.result.email}) سجّل حساباً جديداً وبدأ التجربة المجانية.`,
          link: "/admin",
        }).catch(() => {});
        // رسالة تأكيد البريد للعميل الجديد (تُتجاهل بهدوء إن لم يُضبط مزوّد البريد)
        void import("./emailFlows")
          .then(m => m.sendVerificationEmail(result.result.userId))
          .catch(() => {});
        return {
          success: true,
          name: result.result.fullName,
          email: result.result.email,
          trialEndsAt: result.result.trialEndsAt,
        } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  plans: router({
    // السعر يُقرأ من سوق الزائر لا من عمود واحد. اليوم كل الأسواق تسقط على
    // السعودية لأنها الوحيدة المسعّرة، فالسلوك لم يتغيّر — والهيكل جاهز لأن
    // يفتح سوقاً جديداً بصفٍّ في جدول لا بإصدار جديد.
    list: publicProcedure.query(async ({ ctx }) => {
      const [{ marketFromRequest, pricesForMarket }, list] = await Promise.all([
        import("./marketPricing"),
        getActivePlans(),
      ]);
      const market = marketFromRequest(ctx.req as never, ctx.user?.phone ?? null);
      const prices = await pricesForMarket(market);
      return list.map(p => {
        const pr = prices.get(p.id);
        return pr ? { ...p, price: String(pr.price), currency: pr.currency, market: pr.market, vatRatePct: pr.vatRatePct } : p;
      });
    }),

    /** الأسواق المتاحة لمبدّل العملة — المبدّل يبقى ظاهراً لأن الاستنتاج يخطئ */
    markets: publicProcedure.query(async ({ ctx }) => {
      const { activeMarkets, marketFromRequest } = await import("./marketPricing");
      const { MARKETS } = await import("../shared/pricing");
      const codes = await activeMarkets();
      return {
        current: marketFromRequest(ctx.req as never, ctx.user?.phone ?? null),
        available: codes.map(c => MARKETS[c]),
      };
    }),
    get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => getPlanById(input.id)),
  }),

  credits: router({
    // الرصيد الحالي مع ضمان التجديد الشهري (مشترك بين كل مستخدمي المنظمة)
    balance: protectedProcedure.query(async ({ ctx }) => {
      const { getCreditsBalance } = await import("./credits");
      if (!ctx.effectiveUserId) return null;
      return (await getCreditsBalance(ctx.effectiveUserId)) ?? null;
    }),
    // سجل حركات النقاط (كل حركات المنظمة، من كل المستخدمين)
    transactions: protectedProcedure.query(async ({ ctx }) => {
      const { getCreditTransactions } = await import("./credits");
      if (!ctx.effectiveUserId) return [];
      return getCreditTransactions(ctx.effectiveUserId);
    }),
    // ملخص استهلاك المنظمة الحالية: إجمالي المستندات/الرسائل + تفصيل لكل عضو بالاسم
    usageSummary: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.effectiveUserId) return null;
      const { getOrgUsageSummary } = await import("./credits");
      const summary = await getOrgUsageSummary(ctx.effectiveUserId);
      if (!summary) return null;
      const org = await getOrganizationForUser(ctx.user);
      const members = org ? await listOrgMembers(org.id) : [];
      const nameById = new Map(members.map(m => [m.id, m.name ?? m.email ?? `#${m.id}`]));
      return {
        ...summary,
        byMember: summary.byMember.map(m => ({ ...m, name: nameById.get(m.userId) ?? `#${m.userId}` })),
      };
    }),
  }),

  subscription: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.effectiveUserId) return undefined;
      // إن انتهت فترة التجربة تُفعَّل الباقة المختارة تلقائياً قبل الإرجاع
      await activateTrialIfExpired(ctx.effectiveUserId);
      const sub = await getSubscriptionByUserId(ctx.effectiveUserId);
      // إشعار اقتراب انتهاء التجربة (آخر 24 ساعة، بلا تكرار يومي)
      if (sub?.status === "trial" && sub.endDate) {
        maybeNotifyTrialEnding(ctx.effectiveUserId, sub.endDate).catch(() => {});
      }
      return sub;
    }),
    create: protectedProcedure
      .input(z.object({
        planId: z.number(),
        billing: z.enum(["monthly", "yearly"]).optional(),
        companyName: z.string().optional(),
        companyType: z.string().optional(),
        phone: z.string().optional(),
        vatNumber: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.orgRole !== "owner") {
          throw new TRPCError({ code: "FORBIDDEN", message: "إدارة الاشتراك متاحة لمالك الحساب فقط" });
        }
        const existing = await getSubscriptionByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "لديك اشتراك بالفعل" });
        const { billing, ...rest } = input;
        await createSubscription({ userId: ctx.user.id, ...rest });
        // تعبئة رصيد النقاط الأولي حسب الباقة + تسجيل دورة الفوترة
        const plan = await getPlanById(input.planId);
        const created = await getSubscriptionByUserId(ctx.user.id);
        if (created && plan) {
          await updateSubscription(created.id, {
            billing: billing ?? "monthly",
            creditsBalance: plan.monthlyCredits,
            creditsCycleStart: new Date(),
          });
        }
        return { success: true };
      }),
    // تحويل الاشتراك الحالي بين الفوترة الشهرية والسنوية (دون تغيير الباقة أو الرصيد)
    switchBilling: protectedProcedure
      .input(z.object({ billing: z.enum(["monthly", "yearly"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.orgRole !== "owner") {
          throw new TRPCError({ code: "FORBIDDEN", message: "إدارة الاشتراك متاحة لمالك الحساب فقط" });
        }
        const existing = await getSubscriptionByUserId(ctx.user.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك" });
        if (existing.billing === input.billing) return { success: true, unchanged: true };
        await updateSubscription(existing.id, { billing: input.billing });
        return { success: true, unchanged: false };
      }),
  }),

  organization: router({
    // معلومات المنظمة الحالية (اسمها، دور المستخدم الحالي فيها)
    get: protectedProcedure.query(async ({ ctx }) => {
      const org = await getOrganizationForUser(ctx.user);
      return org ? { id: org.id, name: org.name, isOwner: ctx.user.orgRole === "owner" } : null;
    }),
    // قائمة أعضاء المنظمة (لمالك الحساب فقط)
    members: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.orgRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لمالك الحساب فقط" });
      const org = await getOrganizationForUser(ctx.user);
      if (!org) return [];
      return listOrgMembers(org.id);
    }),
    // دعوة مستخدم فرعي جديد بصلاحيات محددة
    inviteMember: protectedProcedure
      .input(z.object({
        name: z.string().trim().min(1),
        email: z.string().trim().email(),
        password: z.string().min(6),
        permissions: z.object({
          viewInvoices: z.boolean().optional(),
          createInvoices: z.boolean().optional(),
          managePayments: z.boolean().optional(),
          manageErpSettings: z.boolean().optional(),
          manageJournalEntries: z.boolean().optional(),
        }).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.orgRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لمالك الحساب فقط" });
        const org = await getOrganizationForUser(ctx.user);
        if (!org) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحديد المنظمة" });
        const result = await inviteSubUser({
          organizationId: org.id,
          name: input.name,
          email: input.email,
          password: input.password,
          permissions: input.permissions,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        return { success: true, userId: result.userId };
      }),
    updateMemberPermissions: protectedProcedure
      .input(z.object({
        memberId: z.number(),
        permissions: z.object({
          viewInvoices: z.boolean().optional(),
          createInvoices: z.boolean().optional(),
          managePayments: z.boolean().optional(),
          manageErpSettings: z.boolean().optional(),
          manageJournalEntries: z.boolean().optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.orgRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لمالك الحساب فقط" });
        const org = await getOrganizationForUser(ctx.user);
        if (!org) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحديد المنظمة" });
        await updateMemberPermissions(input.memberId, org.id, input.permissions);
        return { success: true };
      }),
    removeMember: protectedProcedure
      .input(z.object({ memberId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.orgRole !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "لمالك الحساب فقط" });
        const org = await getOrganizationForUser(ctx.user);
        if (!org) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحديد المنظمة" });
        await removeMember(input.memberId, org.id);
        return { success: true };
      }),
  }),

  tasks: router({
    list: protectedProcedure.query(({ ctx }) => getTasksByUserId(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(["bookkeeping", "invoice", "journal_entry", "report", "tax", "payroll", "other"]),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sub = await getSubscriptionByUserId(ctx.user.id);
        await createTask({
          userId: ctx.user.id,
          subscriptionId: sub?.id,
          ...input,
        });
        return { success: true };
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const task = await getTaskById(input.id);
        await updateTask(input.id, ctx.user.id, {
          status: input.status,
          completedAt: input.status === "completed" ? new Date() : undefined,
        });
        // إشعار المستخدم عند اكتمال المهمة
        if (input.status === "completed" && task) {
          notifyUser({
            userId: ctx.user.id,
            type: "task_completed",
            title: "اكتملت المهمة",
            body: `المهمة «${task.title}» اكتملت بنجاح.`,
            link: "/tasks",
          }).catch(() => {});
        }
        return { success: true };
      }),
    comments: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ ctx, input }) => {
        const task = await getTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
        if (task.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getTaskCommentsByTaskId(input.taskId);
      }),
    addComment: protectedProcedure
      .input(z.object({ taskId: z.number(), content: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const task = await getTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
        if (task.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createTaskComment({
          taskId: input.taskId,
          userId: ctx.user.id,
          authorRole: ctx.user.role === "admin" ? "admin" : "user",
          content: input.content,
        });
        // إشعار المالك عند تعليق العميل على مهمة
        if (ctx.user.role !== "admin") {
          notifyAdmins({
            title: "تعليق جديد على مهمة — Almoaser AI ERP",
            body: `المهمة: ${task.title}\nمن: ${ctx.user.name ?? "عميل"}\nالتعليق: ${input.content.slice(0, 300)}`,
          }).catch(() => {});
        }
        return { success: true };
      }),
  }),

  invoices: router({
    list: protectedProcedure.query(({ ctx }) => getInvoicesByUserId(ctx.user.id)),
  }),

  register: router({
    submit: publicProcedure
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(9),
        companyName: z.string().optional(),
        companyType: z.string().optional(),
        businessSector: z.string().optional(),
        planId: z.number().optional(),
        message: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await createRegistrationRequest(input);
        // إشعار المسؤول بطلب تسجيل جديد (لا يوقف العملية عند الفشل)
        notifyAdmins({
          title: "طلب تسجيل جديد — Almoaser AI ERP",
          body: `الاسم: ${input.name}\nالبريد: ${input.email}\nالجوال: ${input.phone}\nالشركة: ${input.companyName ?? "-"}\nالنشاط: ${input.companyType ?? "-"}`,
        }).catch(() => {});
        return { success: true };
      }),
  }),

  profile: router({
    update: protectedProcedure
      .input(z.object({
        name: z.string().min(2).max(100).optional(),
        email: z.string().email().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.name && !input.email) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد بيانات للتحديث" });
        }
        await updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),
    // ─── قراءة شهادة التسجيل الضريبي وتعبئة بيانات الشركة منها ───────────────
    // العميل يرفع الشهادة الصادرة من الهيئة بدل أن يكتب أربعة حقول يدوياً —
    // والكتابة اليدوية هي مصدر الأخطاء التي تظهر لاحقاً على كل فاتورة.
    readVatCertificate: protectedProcedure
      .input(z.object({
        fileBase64: z.string().min(100),
        mimeType: z.string().max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        const buf = Buffer.from(input.fileBase64, "base64");
        if (buf.length > 10 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "الملف كبير جداً — الحد الأقصى 10 ميجابايت" });
        }
        const {
          pdfFirstPageToPng, VAT_CERT_SYSTEM_PROMPT, VAT_CERT_SCHEMA,
          crossCheckCertificate, missingRequiredFields,
        } = await import("./vatCertificate");

        let png: Buffer;
        try {
          png = input.mimeType.includes("pdf") ? await pdfFirstPageToPng(buf) : buf;
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "تعذّر فتح الملف" });
        }

        const { storagePut, storageGetSignedUrl } = await import("./storage");
        const { key } = await storagePut(`docs/vatcert-${ctx.user.id}-${Date.now()}.png`, png, "image/png");
        const url = await storageGetSignedUrl(key);

        const { invokeAgentLLM } = await import("./llmProvider");
        let parsed: Record<string, string>;
        try {
          const res = await invokeAgentLLM({
            messages: [
              { role: "system", content: VAT_CERT_SYSTEM_PROMPT },
              { role: "user", content: [
                { type: "text", text: "استخرج بيانات هذه الشهادة." },
                { type: "image_url", image_url: { url, detail: "high" } },
              ] },
            ],
            response_format: { type: "json_schema", json_schema: { name: "vat_certificate", strict: true, schema: VAT_CERT_SCHEMA } },
            maxTokens: 800,
          } as Parameters<typeof invokeAgentLLM>[0]);
          const raw = res?.choices?.[0]?.message?.content;
          parsed = typeof raw === "string" ? JSON.parse(raw) : {};
        } catch (e) {
          console.warn("[readVatCertificate] فشلت القراءة:", e instanceof Error ? e.message : e);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّرت قراءة الشهادة — تأكد من وضوح الملف وحاول مرة أخرى" });
        }

        const data = {
          taxpayerName: parsed.taxpayer_name ?? "",
          vatNumber: (parsed.vat_number ?? "").replace(/\D/g, ""),
          tin: (parsed.tin ?? "").replace(/\D/g, ""),
          address: parsed.address ?? "",
          crNumber: (parsed.cr_number ?? "").replace(/\D/g, ""),
          registrationDate: parsed.registration_date ?? "",
          taxPeriod: parsed.tax_period ?? "",
        };

        // تُعاد للمراجعة لا تُحفظ مباشرة: قراءة آلية تُكتب بلا نظر أسوأ من إدخال يدوي
        const cross = crossCheckCertificate(data.vatNumber, data.tin);
        return {
          data,
          missing: missingRequiredFields(data),
          warning: cross.ok ? null : cross.reason,
        };
      }),
    updateCompany: protectedProcedure
      .input(z.object({
        companyName: z.string().max(255).optional(),
        companyType: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
        vatNumber: z.string().max(50).optional(),
        companyAddress: z.string().max(400).optional(),
        crNumber: z.string().max(30).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sub = await getSubscriptionByUserId(ctx.user.id);
        if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك — اشترك في باقة أولاً" });
        await updateSubscription(sub.id, input);
        return { success: true };
      }),
  }),

  // ─── شات المبيعات العام (بلا تسجيل دخول) ────────────────────────────────────
  sales: router({
    chat: publicProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(SALES_MAX_CHARS),
        })).min(1).max(SALES_MAX_MESSAGES),
        // معرّف العميل المحتمل من رسالة سابقة في نفس الجلسة
        leadId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // مفتوح للعموم وتكلفته علينا: الحدّ بالعنوان يمنع الاستنزاف
        const ip = (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
          || ctx.req.socket?.remoteAddress || "unknown";
        const rate = checkSalesRateLimit(ip);
        if (!rate.ok) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `وصلت للحد المسموح — جرّب بعد ${rate.retryAfterMin} دقيقة` });
        }

        const plans = await getActivePlans();
        const { invokeNamedModel } = await import("./llmProvider");
        const { buildSalesSystemPrompt, SALES_MODELS, SALES_MAX_TOKENS, isUsableSalesReply, hasArabic, extractSignupAction } = await import("./salesAgent");
        const system = buildSalesSystemPrompt(plans);
        const userWroteArabic = input.messages.some(m => m.role === "user" && hasArabic(m.content));

        // نمشي في السلسلة: المجاني أولاً، وأي فشل أو ردّ معطوب ينقلنا للتالي
        let reply: string | undefined;
        for (const model of SALES_MODELS) {
          try {
            const res = await invokeNamedModel({
              messages: [{ role: "system", content: system }, ...input.messages],
              maxTokens: SALES_MAX_TOKENS,
            } as Parameters<typeof invokeNamedModel>[0], model);
            const raw = res?.choices?.[0]?.message?.content;
            const text = typeof raw === "string" ? raw.trim() : "";
            if (text && isUsableSalesReply(text, userWroteArabic)) { reply = text; break; }
            console.warn(`[sales.chat] ${model} أعطى رداً غير صالح — ننتقل للتالي`);
          } catch (e) {
            console.warn(`[sales.chat] ${model} فشل:`, e instanceof Error ? e.message.slice(0, 120) : e);
          }
        }
        if (!reply) {
          return { reply: "اعذرني، فيه ضغط على الخدمة دلوقتي. جرّب بعد شوية أو سجّل من صفحة الاشتراك وفريقنا يتواصل معك.", planId: null, planName: null, leadId: input.leadId ?? null };
        }
        // الزر يُبنى هنا لا في نص الموديل — الروابط التي يكتبها تصل مشوّهة
        const { extractLeadInfo, upsertLead, updateLead, extractLeadFromConversation } = await import("./salesLeads");
        const lead = extractLeadInfo(reply);
        const action = extractSignupAction(lead.text);
        const plan = action.planId ? plans.find(p => p.id === action.planId) : undefined;

        // حفظ ما جمعته سارة — لا يُفشل الرد إن تعثّر
        let leadId = input.leadId ?? null;
        try {
          const { name, phone, ...rest } = lead.patch;
          if (name || phone || leadId == null) {
            // المدينة والنشاط يُمرَّران للمطابقة لا للحفظ: بهما نفرّق بين شخصين
            // يحملان اسماً شائعاً بدل أن ندمجهما في سجل واحد
            const id = await upsertLead({ name, phone, leadId, city: rest.city, activity: rest.activity });
            if (id) leadId = id;
          }
          if (leadId && (Object.keys(rest).length || plan)) {
            await updateLead(leadId, { ...rest, interestedPlanId: plan?.id ?? null });
          }
        } catch (e) {
          console.warn("[sales.chat] تعذّر حفظ بيانات العميل المحتمل:", e instanceof Error ? e.message : e);
        }

        // استخلاص في الخلفية: لا ينتظره العميل، ويلتقط ما لم تُصدره سارة كعلامة
        void (async () => {
          try {
            const found = await extractLeadFromConversation(input.messages);
            if (!Object.keys(found).length) return;
            const { name, phone, ...rest } = found;
            const id = await upsertLead({ name, phone, leadId, city: rest.city, activity: rest.activity });
            if (id) await updateLead(id, rest);
          } catch (e) {
            console.warn("[sales.chat] تعذّر استخلاص بيانات المحادثة:", e instanceof Error ? e.message : e);
          }
        })();

        return {
          reply: action.text,
          planId: plan?.id ?? null,
          planName: plan?.nameAr ?? null,
          leadId,
        };
      }),
  }),

  coupons: router({
    // معاينة قبل الدفع: يرى العميل ما سيدفعه فعلاً بنفس حساب السيرفر
    preview: protectedProcedure
      .input(z.object({
        code: z.string().trim().min(1).max(40),
        scope: z.enum(["subscription", "topup"]),
        netSar: z.number().positive(),
        planId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { resolveCoupon } = await import("./couponService");
        const r = await resolveCoupon({ ...input, userId: ctx.effectiveUserId ?? ctx.user.id });
        return r.ok ? { ok: true as const, ...r.coupon } : { ok: false as const, reason: r.reason };
      }),
  }),

  // ─── تقارير الخبير ───────────────────────────────────────────────────────────
  // المراجعة للعميل نفسه: هو من يقرّ ما أُعدّ له، لا المنصة.
  reports: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { listReportsForUser } = await import("./reports");
      return listReportsForUser(ctx.effectiveUserId ?? ctx.user.id);
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const { getReport } = await import("./reports");
        const r = await getReport(input.id);
        const ownerId = ctx.effectiveUserId ?? ctx.user.id;
        // الأدمن يقرأ أي تقرير؛ غيره تقاريره هو فقط
        if (!r || (r.userId !== ownerId && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "NOT_FOUND", message: "التقرير غير موجود" });
        }
        return r;
      }),
    review: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        approve: z.boolean(),
        note: z.string().trim().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { reviewReport } = await import("./reports");
        const ok = await reviewReport({ ...input, userId: ctx.effectiveUserId ?? ctx.user.id });
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك مراجعة هذا التقرير" });
        return { ok: true };
      }),
  }),

  admin: router({
    // ─── الاطّلاع على محادثات العملاء (لمالك المنصة) ──────────────────────────
    // محادثات العملاء تحمل بياناتهم المالية، فكل فتح لمحادثة يُسجَّل في سجل
    // التدقيق باسم من فتحها — الاطّلاع بلا أثر لا يمكن مراجعته لاحقاً.
    customerConversations: protectedProcedure
      .input(z.object({ userId: z.number().int().positive().optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { listConversationsForAdmin } = await import("./adminConversations");
        return listConversationsForAdmin(input?.userId);
      }),
    customerConversationMessages: protectedProcedure
      .input(z.object({ conversationId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { readConversationForAdmin } = await import("./adminConversations");
        const res = await readConversationForAdmin(input.conversationId);
        if (!res) throw new TRPCError({ code: "NOT_FOUND", message: "المحادثة غير موجودة" });
        const { logAdminAction } = await import("./adminAudit");
        await logAdminAction({
          adminId: ctx.user.id,
          adminName: ctx.user.name ?? undefined,
          action: "view_customer_conversation",
          targetUserId: res.owner.id,
          targetUserEmail: res.owner.email ?? undefined,
          details: `اطّلاع على محادثة #${input.conversationId} — ${res.title}`,
        });
        return res;
      }),
    leads: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listLeads } = await import("./salesLeads");
      return listLeads();
    }),
    setLeadStatus: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), status: z.enum(["new", "contacted", "converted", "declined"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { setLeadStatus } = await import("./salesLeads");
        await setLeadStatus(input.id, input.status);
        return { ok: true };
      }),
    appRequests: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listAppRequests } = await import("./appCatalog");
      return listAppRequests();
    }),
    setAppRequestStatus: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: z.enum(["new", "contacted", "sold", "declined"]),
        note: z.string().trim().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { setRequestStatus } = await import("./appCatalog");
        await setRequestStatus(input.id, input.status, input.note);
        return { ok: true };
      }),
    appCatalog: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listCatalog } = await import("./appCatalog");
      return listCatalog();
    }),
    upsertApp: protectedProcedure
      .input(z.object({
        id: z.number().int().positive().optional(),
        name: z.string().trim().min(2).max(120),
        nameAr: z.string().trim().min(2).max(160),
        description: z.string().trim().max(4000).optional(),
        erpTarget: z.enum(["erpnext", "odoo", "both"]).default("erpnext"),
        status: z.enum(["available", "in_development", "planned"]).default("planned"),
        priceSar: z.number().nonnegative().nullable().optional(),
        repoUrl: z.string().trim().max(300).nullable().optional(),
        version: z.string().trim().max(40).nullable().optional(),
        parentAppId: z.number().int().positive().nullable().optional(),
        changesSummary: z.string().trim().max(4000).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { upsertCatalogApp } = await import("./appCatalog");
        const id = await upsertCatalogApp(input);
        return { ok: true, id };
      }),
    coupons: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listCoupons } = await import("./couponService");
      return listCoupons();
    }),
    createCoupon: protectedProcedure
      .input(z.object({
        code: z.string().trim().min(3).max(40),
        description: z.string().trim().max(255).optional(),
        type: z.enum(["percent", "fixed"]),
        value: z.number().positive(),
        scope: z.enum(["subscription", "topup", "both"]).default("both"),
        minAmountSar: z.number().nonnegative().nullable().optional(),
        maxUses: z.number().int().positive().nullable().optional(),
        maxUsesPerUser: z.number().int().positive().nullable().optional(),
        firstPurchaseOnly: z.boolean().optional(),
        newAccountWithinDays: z.number().int().positive().nullable().optional(),
        planId: z.number().int().positive().nullable().optional(),
        validUntil: z.string().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { createCoupon } = await import("./couponService");
        const r = await createCoupon({
          ...input,
          validFrom: null,
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          createdBy: ctx.user.id,
        });
        if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.reason });
        return r;
      }),
    setCouponActive: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { setCouponActive } = await import("./couponService");
        await setCouponActive(input.id, input.isActive);
        return { ok: true };
      }),
    allReports: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { listAllReports } = await import("./reports");
      return listAllReports();
    }),
    registrations: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllRegistrationRequests();
    }),
    subscriptions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllSubscriptions();
    }),
    tasks: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllTasks();
    }),
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllUsers();
    }),
    setUserRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id && input.role !== "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك إزالة صلاحية المسؤول عن حسابك" });
        }
        await setUserRole(input.userId, input.role);
        const { logAdminAction } = await import("./adminAudit");
        const target = await getUserById(input.userId);
        await logAdminAction({
          adminId: ctx.user.id, adminName: ctx.user.name ?? undefined,
          action: "set_user_role", targetUserId: input.userId, targetUserEmail: target?.email ?? undefined,
          details: `تغيير الدور إلى ${input.role === "admin" ? "مسؤول" : "عميل"}`,
        });
        return { success: true };
      }),
    // تعديل ربط مستخدم بنظامه — طلبه المالك ليصلح ربطاً انكسر بلا انتظار العميل.
    // **يُختبر قبل الحفظ:** حفظ بيانات لا تعمل يترك العميل معطّلاً وهو يظنّ أنه
    // أُصلح، وهو ما وقع أصلاً حين انكسر ربطٌ ولم يعلم به أحد.
    setUserErpConnection: protectedProcedure
      .input(z.object({
        userId: z.number(),
        url: z.string().trim().min(4),
        username: z.string().trim().min(1),
        password: z.string().min(1),
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const cleanUrl = normalizeErpUrl(input.url);
        if (!cleanUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "رابط غير صالح" });

        const test = await testConnectionByProvider(input.provider, cleanUrl, input.username, input.password);
        if (!test.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: test.error ?? "فشل اختبار الاتصال — لم يُحفظ شيء" });
        }

        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });

        const values = {
          provider: input.provider, url: cleanUrl, username: input.username,
          passwordEnc: encryptPassword(input.password), lastVerifiedAt: new Date(),
        };
        const existing = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, input.userId)).limit(1);
        if (existing[0]) {
          await db.update(erpnextConnections).set(values).where(eq(erpnextConnections.userId, input.userId));
        } else {
          await db.insert(erpnextConnections).values({ ...values, userId: input.userId });
        }

        const { logAdminAction } = await import("./adminAudit");
        const target = await getUserById(input.userId);
        await logAdminAction({
          adminId: ctx.user.id, adminName: ctx.user.name ?? undefined,
          action: "set_user_erp_connection", targetUserId: input.userId,
          targetUserEmail: target?.email ?? undefined,
          details: `${cleanUrl} · ${input.username}`,
        }).catch(() => {});

        return { success: true, loggedInAs: test.loggedInAs, url: cleanUrl };
      }),
    setUserActive: protectedProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك تعطيل حسابك" });
        }
        await setUserActive(input.userId, input.isActive);
        const { logAdminAction } = await import("./adminAudit");
        const target = await getUserById(input.userId);
        await logAdminAction({
          adminId: ctx.user.id, adminName: ctx.user.name ?? undefined,
          action: "set_user_active", targetUserId: input.userId, targetUserEmail: target?.email ?? undefined,
          details: input.isActive ? "إعادة تفعيل الحساب" : "تعطيل الحساب",
        });
        return { success: true };
      }),
    // ملخص استهلاك كل العملاء (منظمات): الباقة، الرصيد، عدد المستندات/الرسائل المستهلكة
    usageSummary: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getAllOrgsUsageSummary } = await import("./credits");
      return getAllOrgsUsageSummary();
    }),
    // تحليلات المنصة للمالك: عملاء + استهلاك + ربحية + نصائح تشغيلية
    platformInsights: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getPlatformInsights } = await import("./insights");
      return getPlatformInsights();
    }),
    // تفعيل باقة لعميل بدون دفع فعلي (منحة إدارية)
    activateSubscription: protectedProcedure
      .input(z.object({ userId: z.number(), planId: z.number(), billing: z.enum(["monthly", "yearly"]).default("monthly") }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { activateSubscriptionWithoutPayment } = await import("./adminSubscriptions");
        await activateSubscriptionWithoutPayment({ ...input, adminId: ctx.user.id, adminName: ctx.user.name ?? undefined });
        return { success: true };
      }),
    // تفعيل/تعطيل حالة اشتراك عميل (بدون حذف حسابه أو منعه من تسجيل الدخول)
    setSubscriptionStatus: protectedProcedure
      .input(z.object({ userId: z.number(), status: z.enum(["active", "inactive", "cancelled", "trial"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const sub = await getSubscriptionByUserId(input.userId);
        if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك لهذا العميل" });
        await updateSubscription(sub.id, { status: input.status });
        const { logAdminAction } = await import("./adminAudit");
        const target = await getUserById(input.userId);
        await logAdminAction({
          adminId: ctx.user.id, adminName: ctx.user.name ?? undefined,
          action: "set_subscription_status", targetUserId: input.userId, targetUserEmail: target?.email ?? undefined,
          details: `تغيير حالة الاشتراك إلى ${input.status}`,
        });
        return { success: true };
      }),
    // منح نقاط رصيد إضافية لعميل بدون دفع
    grantCredits: protectedProcedure
      .input(z.object({ userId: z.number(), credits: z.number().int().positive(), note: z.string().trim().max(300).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { grantCreditsManual } = await import("./adminSubscriptions");
        await grantCreditsManual({ ...input, adminId: ctx.user.id, adminName: ctx.user.name ?? undefined });
        return { success: true };
      }),
    // تمديد اشتراك عميل بعدد أيام محدد خارج دورة الباقة
    extendSubscriptionDays: protectedProcedure
      .input(z.object({ userId: z.number(), days: z.number().int().positive().max(365), note: z.string().trim().max(300).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { extendSubscriptionDays: extend } = await import("./adminSubscriptions");
        await extend({ ...input, adminId: ctx.user.id, adminName: ctx.user.name ?? undefined });
        return { success: true };
      }),
    // سجل مدفوعات عميل محدد
    paymentsForUser: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getPaymentsForUser } = await import("./adminSubscriptions");
        return getPaymentsForUser(input.userId);
      }),
    // فواتير خدمة عميل محدد
    invoicesForUser: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getServiceInvoicesForUser } = await import("./adminSubscriptions");
        return getServiceInvoicesForUser(input.userId);
      }),
    // سجل تدقيق كل الإجراءات الإدارية الحساسة
    auditLog: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getAdminActionLog } = await import("./adminAudit");
      return getAdminActionLog();
    }),
    // ملخص الإيرادات الفعلية مقابل قيمة المنح الإدارية المجانية
    revenueSummary: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getRevenueSummary } = await import("./revenue");
      return getRevenueSummary();
    }),
    // ملخص تكلفة استدعاءات النماذج الذكية بالدولار (اليوم/الشهر/الإجمالي) لكل موديل
    llmCostSummary: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getLlmCostSummary } = await import("./llmUsage");
      return getLlmCostSummary();
    }),
    // تفصيل الاستهلاك: من أنفق وعلى أي موديل — يجيب ما لا تجيبه لوحة المزوّد
    // لأن المفتاح مشترك بين سارة وشهد فما يعرضه مجموعٌ واحد
    llmUsageByApp: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        const { getLlmUsageByApp } = await import("./llmUsage");
        return getLlmUsageByApp(input?.days ?? 30);
      }),
    // رصيد المزوّدين المتبقّي وعتبة التنبيه — الرقم الذي يُتّخذ عليه قرار الشحن
    providerBalances: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { getProviderBalances } = await import("./providerBalance");
      return getProviderBalances();
    }),
    // تصدير تقرير مالي كامل (CSV) لكل المدفوعات والمنح الإدارية
    exportFinancialReport: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const { exportFinancialReportCsv } = await import("./revenue");
      return { csv: await exportFinancialReportCsv() };
    }),
  }),

  erpnext: router({
    testConnection: protectedProcedure.query(async ({ ctx }) => {
      try {
        const data = await erpFetch("/api/resource/Company?limit=5", ctx.user.id) as { data: Array<{ name: string }> };
        const companies = data?.data ?? [];
        if (companies.length === 0) return { connected: false, error: "لا توجد شركات" };

        // Get company details
        const companyName = companies[0].name;
        const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`, ctx.user.id) as { data: Record<string, unknown> };
        const company = companyData?.data ?? {};

        return {
          connected: true,
          company: {
            name: company.name as string,
            abbr: company.abbr as string,
            defaultCurrency: company.default_currency as string,
            country: company.country as string,
            email: company.email as string,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { connected: false, error: message };
      }
    }),

    getCompanyInfo: protectedProcedure.query(async ({ ctx }) => {
      const data = await erpFetch("/api/resource/Company?limit=1", ctx.user.id) as { data: Array<{ name: string }> };
      const companies = data?.data ?? [];
      if (companies.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "لا توجد شركات" });

      const companyName = companies[0].name;
      const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`, ctx.user.id) as { data: Record<string, unknown> };
      return companyData?.data ?? {};
    }),

    getAccounts: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(50), parentAccount: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        let url = `/api/resource/Account?limit=${input.limit}&fields=["name","account_name","account_type","root_type","parent_account","is_group","account_currency"]&order_by=lft asc`;
        if (input.parentAccount) {
          url += `&filters=[["parent_account","=","${input.parentAccount}"]]`;
        }
        const data = await erpFetch(url, ctx.user.id) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getItems: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        const data = await erpFetch(`/api/resource/Item?limit=${input.limit}&fields=["name","item_name","item_group","description","standard_rate","stock_uom","is_sales_item","is_purchase_item"]`, ctx.user.id) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getJournalEntries: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Journal Entry?limit=${input.limit}&fields=["name","title","posting_date","total_debit","total_credit","docstatus","voucher_type"]&order_by=posting_date desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { data: [], error: message };
        }
      }),

    getAccountBalance: protectedProcedure
      .input(z.object({ account: z.string() }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/method/frappe.client.get_value?doctype=Account&fieldname=["account_name","account_type","root_type"]&filters={"name":"${encodeURIComponent(input.account)}"}`, ctx.user.id) as { message: Record<string, unknown> };
          return data?.message ?? {};
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
        }
      }),

    // ─── Dashboard Stats ──────────────────────────────────────────────────────
    getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
      try {
        const [customersRes, invoicesRes, suppliersRes, itemsRes] = await Promise.allSettled([
          erpFetch("/api/resource/Customer?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Sales%20Invoice?limit=500&fields=%5B%22name%22%2C%22grand_total%22%2C%22status%22%2C%22posting_date%22%5D&order_by=posting_date%20desc", ctx.user.id) as Promise<{ data: Array<{ name: string; grand_total: number; status: string; posting_date: string }> }>,
          erpFetch("/api/resource/Supplier?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Item?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
        ]);

        const customers = customersRes.status === "fulfilled" ? (customersRes.value?.data ?? []) : [];
        const invoices = invoicesRes.status === "fulfilled" ? (invoicesRes.value?.data ?? []) : [];
        const suppliers = suppliersRes.status === "fulfilled" ? (suppliersRes.value?.data ?? []) : [];
        const items = itemsRes.status === "fulfilled" ? (itemsRes.value?.data ?? []) : [];

        const totalRevenue = invoices.reduce((s: number, inv) => s + (inv.grand_total ?? 0), 0);
        const paidInvoices = invoices.filter(inv => inv.status === "Paid");
        const unpaidInvoices = invoices.filter(inv => inv.status === "Unpaid" || inv.status === "Overdue");
        const paidRevenue = paidInvoices.reduce((s: number, inv) => s + (inv.grand_total ?? 0), 0);

        const monthlyMap: Record<string, number> = {};
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthlyMap[key] = 0;
        }
        for (const inv of invoices) {
          if (!inv.posting_date) continue;
          const key = inv.posting_date.slice(0, 7);
          if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + (inv.grand_total ?? 0);
        }
        const monthlyRevenue = Object.entries(monthlyMap).map(([month, amount]) => ({
          month: new Date(month + "-01").toLocaleDateString("ar-SA-u-ca-gregory", { month: "short", year: "2-digit" }),
          amount: Math.round(amount * 100) / 100,
        }));

        return {
          totalCustomers: customers.length,
          totalSuppliers: suppliers.length,
          totalItems: items.length,
          totalInvoices: invoices.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          paidRevenue: Math.round(paidRevenue * 100) / 100,
          paidInvoices: paidInvoices.length,
          unpaidInvoices: unpaidInvoices.length,
          monthlyRevenue,
          recentInvoices: invoices.slice(0, 5),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

    getCustomers: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Customer?limit=${input.limit}&fields=%5B%22name%22%2C%22customer_name%22%2C%22customer_type%22%2C%22mobile_no%22%2C%22email_id%22%5D&order_by=creation%20desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          return { data: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),

    getSalesInvoices: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Sales%20Invoice?limit=${input.limit}&fields=%5B%22name%22%2C%22customer%22%2C%22posting_date%22%2C%22grand_total%22%2C%22outstanding_amount%22%2C%22status%22%2C%22currency%22%5D&order_by=posting_date%20desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          return { data: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),

    createSalesInvoice: protectedProcedure
      .input(z.object({
        customer: z.string(),
        items: z.array(z.object({
          item_code: z.string(),
          qty: z.number().default(1),
          rate: z.number(),
          description: z.string().optional(),
        })),
        posting_date: z.string().optional(),
        due_date: z.string().optional(),
        currency: z.string().optional().default("OMR"),
      }))
      .mutation(async ({ input, ctx }) => {
        const erpConfig = await getErpConfigForUser(ctx.user.id);
        const erpUrl = erpConfig.url;
        const sid = await getErpSession(erpConfig);
        const body = {
          customer: input.customer,
          posting_date: input.posting_date ?? new Date().toISOString().slice(0, 10),
          due_date: input.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          currency: input.currency,
          items: input.items,
        };
        const res = await fetch(`${erpUrl}/api/resource/Sales%20Invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: `sid=${sid}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `فشل إنشاء الفاتورة: ${errText.slice(0, 300)}` });
        }
        const data = await res.json() as { data: { name: string } };
        return { success: true, invoiceName: data.data?.name };
      }),

  }),

  agent: agentRouter,
  payments: paymentsRouter,
  notifications: notificationsRouter,
  channels: router({
    saveSettings: protectedProcedure
      .input(z.object({
        whatsappToken: z.string().optional(),
        whatsappPhoneId: z.string().optional(),
        whatsappVerifyToken: z.string().optional(),
        telegramBotToken: z.string().optional(),
        telegramChatId: z.string().optional(),
        agentEnabled: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        // In production, store these securely in DB or env
        // For now, return success (settings would be stored in DB)
        return { success: true, message: "Settings saved successfully" };
      }),

    testWhatsapp: protectedProcedure
      .input(z.object({
        token: z.string(),
        phoneId: z.string(),
        testNumber: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v18.0/${input.phoneId}/messages`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${input.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: input.testNumber,
                type: "text",
                text: { body: "✅ اختبار ناجح من نظام Almoaser AI ERP! المحاسب الذكي جاهز للعمل." },
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
            return { success: false, error: err?.error?.message ?? `HTTP ${res.status}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
        }
      }),

    testTelegram: protectedProcedure
      .input(z.object({
        token: z.string(),
        chatId: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${input.token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: input.chatId,
                text: "✅ اختبار ناجح من نظام Almoaser AI ERP! المحاسب الذكي جاهز للعمل.",
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { description?: string };
            return { success: false, error: err?.description ?? `HTTP ${res.status}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
