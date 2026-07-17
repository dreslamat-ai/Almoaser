/**
 * تسجيل الدخول بحساب ERPNext:
 * - يتحقق من بيانات المستخدم (بريد/كلمة مرور) مباشرة على خادم ERPNext عبر /api/method/login
 * - عند النجاح: ينشئ/يربط حساب المستخدم محلياً بنفس بريد ERPNext (openId = erp:<url>|<email>)
 * - يصدر نفس جلسة JWT المستخدمة في النظام (كوكي app_session_id) فتعمل كل protectedProcedure كما هي
 */
import crypto from "crypto";
import { getDb, upsertUser, getUserByOpenId } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export type ErpLoginResult = {
  fullName: string;
  email: string;
  openId: string;
};

/** يبني openId ثابتاً وفريداً لكل مستخدم ERPNext (خادم + بريد) وبطول <= 64 حرفاً */
export function buildErpOpenId(erpUrl: string, email: string): string {
  const raw = `${erpUrl.replace(/\/+$/, "").toLowerCase()}|${email.trim().toLowerCase()}`;
  // hash قصير لضمان الفرادة مع بادئة بريد واضحة، والإجمالي <= 64 حرفاً
  const h = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const emailPart = email.trim().toLowerCase().slice(0, 44).replace(/[^a-z0-9@._-]/g, "_");
  return `erp:${emailPart}:${h}`.slice(0, 64);
}

/** يتحقق من بيانات الاعتماد على خادم ERPNext ويرجع اسم المستخدم الكامل */
export async function verifyErpCredentials(
  erpUrl: string,
  email: string,
  password: string
): Promise<{ ok: true; fullName: string } | { ok: false; error: string }> {
  const cleanUrl = erpUrl.replace(/\/+$/, "");
  if (!cleanUrl) return { ok: false, error: "رابط نظام ERPNext غير مضبوط" };
  try {
    const res = await fetch(`${cleanUrl}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: email, pwd: password }),
    });
    if (res.status === 401 || res.status === 417) {
      return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    }
    if (!res.ok) {
      return { ok: false, error: `تعذّر التحقق من الحساب (${res.status}) — حاول لاحقاً` };
    }
    const cookie = res.headers.get("set-cookie") ?? "";
    const m = cookie.match(/sid=([^;]+)/);
    if (!m || m[1] === "Guest") {
      return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    }
    const body = (await res.json().catch(() => ({}))) as { full_name?: string };
    return { ok: true, fullName: body.full_name ?? email };
  } catch (e) {
    return { ok: false, error: `تعذّر الوصول إلى خادم ERPNext: ${e instanceof Error ? e.message : "خطأ غير معروف"}` };
  }
}

/**
 * تسجيل دخول كامل: تحقق من ERPNext ثم اربط/أنشئ الحساب المحلي.
 * إن وُجد مستخدم محلي سابق بنفس البريد (مثلاً سجّل عبر Manus OAuth) يُعاد استخدام حسابه
 * للحفاظ على محادثاته وبياناته بدلاً من إنشاء حساب جديد.
 */
export async function loginWithErpAccount(
  erpUrl: string,
  email: string,
  password: string
): Promise<{ ok: true; result: ErpLoginResult } | { ok: false; error: string }> {
  const verified = await verifyErpCredentials(erpUrl, email, password);
  if (!verified.ok) return verified;

  const normalizedEmail = email.trim().toLowerCase();
  const erpOpenId = buildErpOpenId(erpUrl, normalizedEmail);

  // 1) هل يوجد حساب سبق ربطه بنفس openId؟
  let user = await getUserByOpenId(erpOpenId);

  // 2) وإلا: هل يوجد حساب محلي بنفس البريد (من OAuth سابقاً)؟ نعيد استخدامه
  if (!user) {
    try {
      const db = await getDb();
      if (db) {
        const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
        if (rows[0]) user = rows[0];
      }
    } catch { /* non-blocking */ }
  }

  const now = new Date();
  if (user) {
    await upsertUser({
      openId: user.openId,
      name: verified.fullName,
      email: normalizedEmail,
      loginMethod: "erpnext",
      lastSignedIn: now,
    });
    return { ok: true, result: { fullName: verified.fullName, email: normalizedEmail, openId: user.openId } };
  }

  // 3) إنشاء حساب جديد مربوط بحساب ERPNext
  await upsertUser({
    openId: erpOpenId,
    name: verified.fullName,
    email: normalizedEmail,
    loginMethod: "erpnext",
    lastSignedIn: now,
  });
  return { ok: true, result: { fullName: verified.fullName, email: normalizedEmail, openId: erpOpenId } };
}

/**
 * تسجيل مستخدم جديد:
 * 1) يتحقق من بيانات حسابه على نظام ERPNext الخاص به (الرابط الذي أدخله)
 * 2) ينشئ حسابه محلياً ويربطه ببريده
 * 3) يحفظ اتصال نظامه (الرابط + البريد + كلمة المرور مشفرة) ليستخدمه الوكيل تلقائياً
 * 4) ينشئ اشتراكاً بفترة تجريبية 3 أيام على الباقة المختارة
 */
export async function signupWithErpAccount(params: {
  erpUrl: string;
  email: string;
  password: string;
  planId: number;
  companyName?: string;
  phone?: string;
}): Promise<{ ok: true; result: ErpLoginResult & { userId: number; trialEndsAt: Date } } | { ok: false; error: string }> {
  const cleanUrl = params.erpUrl.replace(/\/+$/, "");
  if (!/^https?:\/\/.+/.test(cleanUrl)) {
    return { ok: false, error: "رابط النظام غير صالح — يجب أن يبدأ بـ https://" };
  }

  const login = await loginWithErpAccount(cleanUrl, params.email, params.password);
  if (!login.ok) return login;

  const db = await getDb();
  if (!db) return { ok: false, error: "تعذّر الاتصال بقاعدة البيانات" };

  const userRows = await db.select().from(users).where(eq(users.openId, login.result.openId)).limit(1);
  const user = userRows[0];
  if (!user) return { ok: false, error: "تعذّر إنشاء الحساب" };

  // حفظ اتصال ERPNext الخاص بالمستخدم (upsert)
  const { encryptPassword } = await import("./erpConnection");
  const { erpnextConnections, subscriptions } = await import("../drizzle/schema");
  const existingConn = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, user.id)).limit(1);
  const connValues = {
    url: cleanUrl,
    username: login.result.email,
    passwordEnc: encryptPassword(params.password),
    lastVerifiedAt: new Date(),
  };
  if (existingConn[0]) {
    await db.update(erpnextConnections).set(connValues).where(eq(erpnextConnections.userId, user.id));
  } else {
    await db.insert(erpnextConnections).values({ userId: user.id, ...connValues });
  }

  // إنشاء اشتراك تجريبي 3 أيام إن لم يوجد اشتراك سابق
  const TRIAL_DAYS = 3;
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const existingSub = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
  if (!existingSub[0]) {
    await db.insert(subscriptions).values({
      userId: user.id,
      planId: params.planId,
      status: "trial",
      startDate: new Date(),
      endDate: trialEndsAt,
      companyName: params.companyName ?? null,
      phone: params.phone ?? null,
      notes: `فترة تجريبية ${TRIAL_DAYS} أيام — تبدأ الباقة بعد انتهائها`,
    });
  }

  return { ok: true, result: { ...login.result, userId: user.id, trialEndsAt } };
}

/**
 * انتقال الاشتراك من التجربة إلى الباقة:
 * إذا انتهت فترة التجربة (endDate في الماضي) تُفعَّل الباقة المختارة تلقائياً
 * لمدة دورة فوترة كاملة (شهر) بدءاً من لحظة انتهاء التجربة.
 */
export async function activateTrialIfExpired(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { subscriptions } = await import("../drizzle/schema");
  const rows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  const sub = rows[0];
  if (!sub || sub.status !== "trial" || !sub.endDate) return;
  const now = new Date();
  if (sub.endDate.getTime() > now.getTime()) return; // التجربة ما زالت سارية

  // بدء الباقة: دورة شهرية من نهاية التجربة
  const cycleEnd = new Date(sub.endDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  await db.update(subscriptions).set({
    status: "active",
    startDate: sub.endDate,
    endDate: cycleEnd,
    notes: `${sub.notes ?? ""}\nانتهت التجربة وبدأت الباقة تلقائياً في ${sub.endDate.toISOString().slice(0, 10)}`.trim(),
  }).where(eq(subscriptions.id, sub.id));
}
