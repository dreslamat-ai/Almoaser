/**
 * رسائل البريد التطبيقية: تأكيد البريد، الإشعارات، تذكيرات الانتهاء، وفواتير
 * الدفع والتجديد. كلها تمرّ على sendEmail (مستقلة عن المزوّد) ولا ترمي استثناءات.
 */
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { users, emailVerificationTokens } from "../drizzle/schema";
import { sendEmail, renderEmail, renderRows, appBaseUrl, isEmailConfigured } from "./email";
import { getSellerIdentity } from "./sellerIdentity";

const TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── تأكيد البريد الإلكتروني ──────────────────────────────────────────────────

/** يُنشئ توكناً جديداً ويرسل رسالة التأكيد. يرجع false إن لم يكن البريد مضبوطاً */
export async function sendVerificationEmail(userId: number): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "قاعدة البيانات غير متاحة" };

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.email) return { ok: false, reason: "لا يوجد بريد إلكتروني مسجّل للمستخدم" };
  if (user.emailVerifiedAt) return { ok: false, reason: "البريد مؤكَّد بالفعل" };

  // توكن عشوائي يُرسل للمستخدم، ونخزّن hash فقط
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await db.insert(emailVerificationTokens).values({
    userId, email: user.email, tokenHash: hashToken(token), expiresAt,
  });

  const url = `${appBaseUrl()}/verify-email?token=${token}`;
  const res = await sendEmail({
    to: user.email,
    subject: "أكّد بريدك الإلكتروني لتفعيل حسابك — المعاصر",
    html: renderEmail({
      badge: "تفعيل الحساب",
      heading: `مرحباً ${user.name ?? ""}`.trim() || "مرحباً بك في المعاصر",
      intro: "خطوة واحدة تفصلك عن استخدام حسابك: أكّد بريدك الإلكتروني بالضغط على الزر أدناه.",
      preview: "أكّد بريدك الإلكتروني لتفعيل حسابك في المعاصر",
      ctaLabel: "تأكيد البريد وتفعيل الحساب",
      ctaUrl: url,
      footerNote: `الرابط صالح لمدة ${TOKEN_TTL_HOURS} ساعة ويُستخدم مرة واحدة. إن لم تكن أنت من طلب هذا، تجاهل الرسالة.`,
    }),
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.skipped ? "مزوّد البريد غير مضبوط" : res.error };
}

/** يتحقق من التوكن ويؤكّد البريد. يستهلك التوكن مرة واحدة فقط */
export async function verifyEmailToken(token: string): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "قاعدة البيانات غير متاحة" };

  const rows = await db.select().from(emailVerificationTokens).where(and(
    eq(emailVerificationTokens.tokenHash, hashToken(token)),
    isNull(emailVerificationTokens.usedAt),
    gt(emailVerificationTokens.expiresAt, new Date()),
  )).limit(1);
  const rec = rows[0];
  if (!rec) return { ok: false, reason: "رابط التأكيد غير صالح أو منتهي الصلاحية — اطلب رابطاً جديداً" };

  await db.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, rec.id));
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, rec.userId));
  return { ok: true, email: rec.email };
}

// ─── إشعارات وتذكيرات على البريد ──────────────────────────────────────────────

/** يجلب بريد المستخدم إن كان مؤكَّداً ومفعّلاً للإشعارات */
async function emailTargetFor(userId: number): Promise<string | null> {
  if (!isEmailConfigured()) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const u = rows[0];
  if (!u?.email || !u.emailVerifiedAt || !u.emailNotifications) return null;
  return u.email;
}

/** نسخة بريدية من إشعار داخل التطبيق — تُتجاهل بهدوء إن لم يكن البريد مؤكداً */
export async function emailNotification(userId: number, input: { title: string; body?: string; link?: string }): Promise<void> {
  const to = await emailTargetFor(userId);
  if (!to) return;
  const url = input.link ? `${appBaseUrl()}${input.link.startsWith("/") ? "" : "/"}${input.link}` : undefined;
  await sendEmail({
    to,
    subject: input.title,
    html: renderEmail({
      badge: "إشعار",
      heading: input.title,
      intro: input.body,
      preview: input.body ?? input.title,
      ctaLabel: url ? "عرض التفاصيل" : undefined,
      ctaUrl: url,
      footerNote: "تتلقى هذه الرسالة لأن إشعارات البريد مفعّلة في حسابك — يمكنك إيقافها من إعدادات الحساب.",
    }),
  });
}

/** تذكير باقتراب انتهاء الاشتراك */
export async function emailSubscriptionReminder(userId: number, input: {
  planName: string; daysLeft: number; endDate: string; isTrial: boolean;
}): Promise<void> {
  const to = await emailTargetFor(userId);
  if (!to) return;
  const what = input.isTrial ? "فترتك التجريبية" : "اشتراكك";
  await sendEmail({
    to,
    subject: `تنبيه: ${what} ينتهي بعد ${input.daysLeft} ${input.daysLeft === 1 ? "يوم" : "أيام"}`,
    html: renderEmail({
      badge: "تذكير بالتجديد",
      tone: "warning",
      preview: `${what} ينتهي بعد ${input.daysLeft} ${input.daysLeft === 1 ? "يوم" : "أيام"}`,
      heading: `${what} على وشك الانتهاء`,
      intro: `لتفادي توقف الخدمة، يمكنك التجديد الآن من صفحة الاشتراك.`,
      bodyHtml: renderRows([
        { label: "الباقة", value: input.planName },
        { label: "تاريخ الانتهاء", value: input.endDate },
        { label: "المتبقي", value: `${input.daysLeft} ${input.daysLeft === 1 ? "يوم" : "أيام"}`, bold: true },
      ]),
      ctaLabel: "تجديد الاشتراك",
      ctaUrl: `${appBaseUrl()}/subscription`,
    }),
  });
}

// ─── فواتير الدفع والتجديد ────────────────────────────────────────────────────

/** إيصال/فاتورة بعد نجاح الدفع (اشتراك جديد، تجديد، أو شراء نقاط) */
export async function emailPaymentReceipt(userId: number, input: {
  purpose: "subscription" | "topup" | "extension";
  invoiceId?: string | null;
  planName?: string | null;
  billing?: "monthly" | "yearly" | null;
  credits?: number | null;
  amount: number;
  /** الضريبة داخل amount — تُعرض منفصلة كما تُلزم الفاتورة الضريبية */
  vatAmount?: number | null;
  discountAmount?: number | null;
  currency?: string;
  paidAt?: Date;
  periodEnd?: string | null;
}): Promise<void> {
  // الإيصال يُرسل حتى لو لم يُؤكَّد البريد بعد — فهو مستند مالي طلبه العميل ضمناً بالدفع
  if (!isEmailConfigured()) return;
  const db = await getDb();
  if (!db) return;
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const to = rows[0]?.email;
  if (!to) return;

  const currency = input.currency ?? "SAR";
  const isTopup = input.purpose === "topup";
  const paidAt = (input.paidAt ?? new Date()).toISOString().slice(0, 10);

  const purposeLabel = isTopup ? "شراء نقاط إضافية"
    : input.purpose === "extension" ? "تمديد الاشتراك"
    : "اشتراك / تجديد";
  const detailRows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: "نوع العملية", value: purposeLabel },
  ];
  if (!isTopup && input.planName) detailRows.push({ label: "الباقة", value: input.planName });
  if (!isTopup && input.billing) detailRows.push({ label: "دورة الفوترة", value: input.billing === "yearly" ? "سنوي" : "شهري" });
  if (isTopup && input.credits) detailRows.push({ label: "النقاط المضافة", value: String(input.credits) });
  if (input.periodEnd) detailRows.push({ label: "الاشتراك ساري حتى", value: input.periodEnd });
  if (input.invoiceId) detailRows.push({ label: "رقم الفاتورة", value: input.invoiceId });
  detailRows.push({ label: "تاريخ الدفع", value: paidAt });

  // الفاتورة الضريبية تلزم بعرض الضريبة منفصلة عن الصافي لا مبلغاً واحداً
  const vat = Number(input.vatAmount ?? 0);
  const discount = Number(input.discountAmount ?? 0);
  const net = Math.round((input.amount - vat) * 100) / 100;
  const money = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  if (discount > 0) detailRows.push({ label: "الخصم", value: `− ${money(discount)}` });
  if (vat > 0) {
    detailRows.push({ label: "الإجمالي قبل الضريبة", value: money(net) });
    detailRows.push({ label: "ضريبة القيمة المضافة 15%", value: money(vat) });
  }
  detailRows.push({ label: "الإجمالي المدفوع", value: money(input.amount), bold: true });

  // بيانات البائع: بدونها الإيصال ليس فاتورة ضريبية معتمدة
  const sellerState = getSellerIdentity();
  if (sellerState.configured) {
    const s = sellerState.seller;
    detailRows.push({ label: "المورّد", value: s.legalName });
    detailRows.push({ label: "الرقم الضريبي للمورّد", value: s.vatNumber });
    detailRows.push({ label: "عنوان المورّد", value: s.address });
  } else {
    console.warn("[emailPaymentReceipt] بيانات البائع ناقصة — الإيصال ليس فاتورة ضريبية:", sellerState.missing.join("، "));
  }

  await sendEmail({
    to,
    subject: isTopup ? `فاتورة شراء نقاط — ${input.amount} ${currency}` : `فاتورة الاشتراك — ${input.amount} ${currency}`,
    html: renderEmail({
      // الفاتورة الضريبية تحمل ترويسة الكيان القانوني الذي أصدرها
      brand: sellerState.configured ? "company" : "product",
      badge: vat > 0 && sellerState.configured ? "فاتورة ضريبية مبسّطة" : "إيصال دفع",
      tone: "success",
      preview: `تم استلام ${input.amount.toLocaleString("en-US")} ${currency} بنجاح`,
      heading: vat > 0 && sellerState.configured ? "فاتورة ضريبية — تم استلام دفعتك" : "تم استلام دفعتك بنجاح",
      intro: "شكراً لك. هذه تفاصيل عمليتك، ويمكنك دائماً مراجعة سجل المدفوعات من حسابك.",
      bodyHtml: renderRows(detailRows),
      ctaLabel: "عرض سجل المدفوعات",
      ctaUrl: `${appBaseUrl()}/subscription`,
      footerNote: sellerState.configured
        ? "هذه فاتورة ضريبية صادرة إلكترونياً ولا تحتاج توقيعاً. الضريبة موضحة أعلاه."
        : "الأسعار لا تشمل ضريبة القيمة المضافة إلا إن ذُكر خلاف ذلك.",
    }),
  });
}

// ─── رمز تحقق الدخول (OTP) ────────────────────────────────────────────────────

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

/**
 * ينشئ رمز دخول من 6 أرقام ويرسله على بريد المستخدم.
 * يرجع challengeId ليُمرَّر في خطوة التحقق. إن فشل الإرسال يرجع ok:false —
 * والمُستدعي يقرر (نحن نسمح بالدخول بدون OTP عند فشل الإرسال بدل حبس العميل).
 */
export async function createAndSendLoginOtp(userId: number): Promise<{ ok: true; challengeId: string; maskedEmail: string } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "قاعدة البيانات غير متاحة" };
  const { loginOtps } = await import("../drizzle/schema");

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user?.email) return { ok: false, reason: "لا يوجد بريد إلكتروني مسجّل لهذا الحساب" };
  if (!isEmailConfigured()) return { ok: false, reason: "خدمة البريد غير مضبوطة" };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const challengeId = crypto.randomBytes(24).toString("hex");
  await db.insert(loginOtps).values({
    userId,
    email: user.email,
    codeHash: hashToken(code),
    challengeId,
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });

  const { renderCode } = await import("./email");
  const res = await sendEmail({
    to: user.email,
    subject: `رمز تسجيل الدخول: ${code} — المعاصر`,
    html: renderEmail({
      badge: "تسجيل الدخول",
      heading: "رمز تأكيد تسجيل الدخول",
      intro: "استخدم الرمز التالي لإكمال تسجيل الدخول إلى حسابك.",
      preview: `رمز تسجيل الدخول الخاص بك: ${code}`,
      bodyHtml: renderCode(code, `صالح لمدة ${OTP_TTL_MINUTES} دقائق`),
      footerNote: "إن لم تكن أنت من حاول تسجيل الدخول، فلا تشارك هذا الرمز مع أي شخص، ويُستحسن تغيير كلمة مرور حسابك في نظام ERP.",
    }),
  });
  if (!res.ok) return { ok: false, reason: res.skipped ? "خدمة البريد غير مضبوطة" : (res.error ?? "تعذّر إرسال الرمز") };

  return { ok: true, challengeId, maskedEmail: maskEmail(user.email) };
}

/** يخفي أغلب البريد للعرض في الواجهة: ah***@gmail.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(3, local.length - head.length))}@${domain}`;
}

/** يتحقق من الرمز. يستهلكه مرة واحدة ويحدّ من المحاولات */
export async function verifyLoginOtp(challengeId: string, code: string): Promise<{ ok: true; userId: number } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "قاعدة البيانات غير متاحة" };
  const { loginOtps } = await import("../drizzle/schema");

  const rows = await db.select().from(loginOtps).where(eq(loginOtps.challengeId, challengeId)).limit(1);
  const rec = rows[0];
  if (!rec) return { ok: false, reason: "طلب الدخول غير معروف — أعد تسجيل الدخول" };
  if (rec.consumedAt) return { ok: false, reason: "هذا الرمز استُخدم بالفعل — أعد تسجيل الدخول" };
  if (rec.expiresAt.getTime() < Date.now()) return { ok: false, reason: "انتهت صلاحية الرمز — أعد تسجيل الدخول لإرسال رمز جديد" };
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "تجاوزت عدد المحاولات المسموح — أعد تسجيل الدخول لإرسال رمز جديد" };
  }

  if (hashToken(code.trim()) !== rec.codeHash) {
    await db.update(loginOtps).set({ attempts: rec.attempts + 1 }).where(eq(loginOtps.id, rec.id));
    const left = OTP_MAX_ATTEMPTS - (rec.attempts + 1);
    return { ok: false, reason: left > 0 ? `الرمز غير صحيح — متبقٍ ${left} محاولات` : "الرمز غير صحيح وتجاوزت عدد المحاولات — أعد تسجيل الدخول" };
  }

  await db.update(loginOtps).set({ consumedAt: new Date() }).where(eq(loginOtps.id, rec.id));
  return { ok: true, userId: rec.userId };
}
