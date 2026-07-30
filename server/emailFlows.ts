/**
 * رسائل البريد التطبيقية: تأكيد البريد، الإشعارات، تذكيرات الانتهاء، وفواتير
 * الدفع والتجديد. كلها تمرّ على sendEmail (مستقلة عن المزوّد) ولا ترمي استثناءات.
 */
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { users, emailVerificationTokens } from "../drizzle/schema";
import { sendEmail, renderEmail, renderRows, appBaseUrl, isEmailConfigured } from "./email";

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
    subject: "أكّد بريدك الإلكتروني — المعاصر",
    html: renderEmail({
      heading: `مرحباً ${user.name ?? ""}`.trim(),
      intro: "لتأكيد بريدك الإلكتروني وتنشيط إشعارات حسابك، اضغط الزر أدناه.",
      ctaLabel: "تأكيد البريد الإلكتروني",
      ctaUrl: url,
      footerNote: `الرابط صالح لمدة ${TOKEN_TTL_HOURS} ساعة. إن لم تكن أنت من طلب هذا، تجاهل الرسالة.`,
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
      heading: input.title,
      intro: input.body,
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
  detailRows.push({ label: "المبلغ المدفوع", value: `${input.amount.toLocaleString("en-US")} ${currency}`, bold: true });

  await sendEmail({
    to,
    subject: isTopup ? `إيصال شراء نقاط — ${input.amount} ${currency}` : `إيصال دفع الاشتراك — ${input.amount} ${currency}`,
    html: renderEmail({
      heading: "تم استلام دفعتك بنجاح",
      intro: "شكراً لك. هذه تفاصيل عمليتك، ويمكنك دائماً مراجعة سجل المدفوعات من حسابك.",
      bodyHtml: renderRows(detailRows),
      ctaLabel: "عرض سجل المدفوعات",
      ctaUrl: `${appBaseUrl()}/subscription`,
      footerNote: "الأسعار لا تشمل ضريبة القيمة المضافة إلا إن ذُكر خلاف ذلك.",
    }),
  });
}
