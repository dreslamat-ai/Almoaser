import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
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
import { eq } from "drizzle-orm";
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
        url: z.string().url("رابط غير صالح — يجب أن يبدأ بـ https://"),
        username: z.string().min(1, "اسم المستخدم مطلوب"),
        password: z.string().min(1, "كلمة المرور مطلوبة"),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireMemberPermission(ctx.user, "manageErpSettings");
        const cleanUrl = input.url.replace(/\/+$/, "");
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
        url: z.string().url(),
        username: z.string().min(1),
        password: z.string().min(1),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input }) => {
        return testConnectionByProvider(input.provider, input.url, input.username, input.password, input.database);
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
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ?? null),
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
        const sessionToken = await sdk.createSessionToken(result.user.openId, {
          name: result.user.name ?? "",
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        return { success: true, name: result.user.name, email: result.user.email } as const;
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
        const sessionToken = await sdk.createSessionToken(result.result.openId, {
          name: result.result.fullName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        return { success: true, name: result.result.fullName, email: result.result.email } as const;
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
        phone: z.string().trim().max(20).optional(),
        provider: z.enum(["erpnext", "odoo"]).default("erpnext"),
        database: z.string().trim().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await signupWithErpAccount(input);
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
    list: publicProcedure.query(() => getActivePlans()),
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
    updateCompany: protectedProcedure
      .input(z.object({
        companyName: z.string().max(255).optional(),
        companyType: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
        vatNumber: z.string().max(50).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sub = await getSubscriptionByUserId(ctx.user.id);
        if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك — اشترك في باقة أولاً" });
        await updateSubscription(sub.id, input);
        return { success: true };
      }),
  }),

  admin: router({
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
          month: new Date(month + "-01").toLocaleDateString("ar-SA", { month: "short", year: "2-digit" }),
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

    agentChat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        const erpUrl = (await getErpConfigForUser(ctx.user.id)).url || "demo.almoaser.cloud";
        let erpContext = "";
        try {
          const [customersRes, invoicesRes, itemsRes] = await Promise.allSettled([
            erpFetch("/api/resource/Customer?limit=20&fields=%5B%22name%22%2C%22customer_name%22%5D", ctx.user.id) as Promise<{ data: Array<{ name: string; customer_name: string }> }>,
            erpFetch("/api/resource/Sales%20Invoice?limit=10&fields=%5B%22name%22%2C%22customer%22%2C%22grand_total%22%2C%22status%22%5D&order_by=posting_date%20desc", ctx.user.id) as Promise<{ data: Array<{ name: string; customer: string; grand_total: number; status: string }> }>,
            erpFetch("/api/resource/Item?limit=20&fields=%5B%22name%22%2C%22item_name%22%2C%22standard_rate%22%5D", ctx.user.id) as Promise<{ data: Array<{ name: string; item_name: string; standard_rate: number }> }>,
          ]);
          const customers = customersRes.status === "fulfilled" ? customersRes.value?.data ?? [] : [];
          const invoices = invoicesRes.status === "fulfilled" ? invoicesRes.value?.data ?? [] : [];
          const items = itemsRes.status === "fulfilled" ? itemsRes.value?.data ?? [] : [];
          erpContext = `\nبيانات ERPNext الحالية (${erpUrl}):\n- العملاء (${customers.length}): ${customers.map((c: { name: string; customer_name: string }) => c.customer_name || c.name).slice(0, 10).join(", ")}\n- آخر الفواتير (${invoices.length}): ${invoices.slice(0, 5).map((i: { name: string; customer: string; grand_total: number; status: string }) => `${i.name} - ${i.customer} - ${i.grand_total} (${i.status})`).join(" | ")}\n- الاصناف (${items.length}): ${items.map((i: { name: string; item_name: string; standard_rate: number }) => `${i.item_name} (${i.standard_rate})`).slice(0, 10).join(", ")}`;
        } catch {
          erpContext = "لم يتمكن الوكيل من جلب بيانات ERPNext حالياً.";
        }

        const systemPrompt = `انت وكيل ذكاء اصطناعي متخصص في نظام ERPNext للمحاسبة والمبيعات والمشتريات.\nتعمل مع شركة تستخدم نظام Almoaser AI ERP.\nمهمتك: مساعدة المستخدم في انشاء الفواتير، جلب التقارير، الاستعلام عن العملاء والاصناف، وتنفيذ العمليات المحاسبية.\nتحدث دائما بالعربية وكن مختصرا ومفيدا.\nعند طلب انشاء فاتورة، اطلب: اسم العميل، الصنف، الكمية، السعر.\nعند طلب تقرير، قدم ملخصا واضحا من البيانات المتاحة.\n${erpContext}`;

        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        const result = await invokeLLM({ messages: llmMessages, maxTokens: 1000 });
        const reply = result.choices[0]?.message?.content;
        const replyText = typeof reply === "string" ? reply : Array.isArray(reply) ? reply.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("") : "";
        return { reply: replyText };
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
                text: { body: "✅ اختبار ناجح من نظام Almoaser AI ERP! الوكيل الذكي جاهز للعمل." },
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
                text: "✅ اختبار ناجح من نظام Almoaser AI ERP! الوكيل الذكي جاهز للعمل.",
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
