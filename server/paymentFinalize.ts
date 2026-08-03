// ─── تفعيل الدفع بعد التأكد من نجاحه — يُستخدم من verifyPayment (عودة العميل)
// ومن webhook الخاص بـ MyFatoorah (إشعار خادم-لخادم) لضمان عدم ضياع أي دفعة
// حتى لو أغلق العميل المتصفح قبل رجوعه لصفحة الكولباك ───────────────────────────
import { eq } from "drizzle-orm";
import { getDb, getPlanById, getSubscriptionByUserId, getExpertSubscription, createSubscription, updateSubscription } from "./db";
import { payments } from "../drizzle/schema";
import type { PaymentStatusResult } from "./myfatoorah";
import { addTopupCredits } from "./credits";

export type FinalizeResult = {
  status: "paid" | "failed" | "already_paid" | "not_found";
  purpose?: "subscription" | "topup" | "extension";
  paymentId?: number;
};

/**
 * يُنهي معالجة دفعة بناءً على حالتها الفعلية لدى MyFatoorah (لا نثق بأي بيانات
 * عمل واردة من جسم webhook مباشرة — دائماً نعيد الاستعلام عبر GetPaymentStatus
 * الموثّق بمفتاح API الخاص بنا). آمن للاستدعاء المتكرر لنفس الدفعة (idempotent).
 */
export async function finalizePaymentByReference(status: PaymentStatusResult): Promise<FinalizeResult> {
  const db = await getDb();
  if (!db) return { status: "failed" };
  const internalId = Number(status.CustomerReference ?? 0);
  if (!internalId) return { status: "not_found" };

  const rows = await db.select().from(payments).where(eq(payments.id, internalId)).limit(1);
  const payment = rows[0];
  if (!payment) return { status: "not_found" };
  if (payment.status === "paid") return { status: "already_paid", purpose: payment.purpose, paymentId: payment.id };

  if (status.InvoiceStatus !== "Paid") {
    await db.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
    return { status: "failed", purpose: payment.purpose, paymentId: payment.id };
  }

  await db.update(payments).set({ status: "paid", paidAt: new Date() }).where(eq(payments.id, payment.id));

  let periodEnd: string | null = null;
  let planName: string | null = null;

  if (payment.purpose === "subscription" && payment.planId) {
    const plan = await getPlanById(payment.planId);
    planName = plan?.nameAr ?? null;
    const periodMs = payment.billing === "yearly" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    const newEnd = new Date(Date.now() + periodMs);
    periodEnd = newEnd.toISOString().slice(0, 10);

    // باقة الخبير خدمة موازية: تُضاف كاشتراك ثانٍ ولا تُكتب فوق الاشتراك
    // المحاسبي — الكتابة فوقه كانت ستُسقط فوترة العميل مقابل خدمة تقييم.
    const isExpertPlan = plan?.mode === "expert";
    const target = isExpertPlan
      ? await getExpertSubscription(payment.userId)
      : await getSubscriptionByUserId(payment.userId);

    const values = {
      planId: payment.planId,
      status: "active" as const,
      billing: payment.billing ?? "monthly",
      endDate: newEnd,
      ...(plan ? { creditsBalance: plan.monthlyCredits, creditsCycleStart: new Date() } : {}),
    };

    if (target) {
      await updateSubscription(target.id, values);
    } else {
      // أول اشتراك من هذا النوع — يُنشأ بدل أن تضيع الدفعة بلا أثر
      await createSubscription({ userId: payment.userId, ...values });
    }
  } else if (payment.purpose === "topup" && payment.credits) {
    await addTopupCredits(payment.userId, payment.credits, `شحن ${payment.credits} نقطة عبر MyFatoorah`);
  }

  // ─── فاتورة الخدمة ────────────────────────────────────────────────────
  // **لم يكن أحد يكتب في `service_invoices` قط.** الصفحة تقرأ منه، والجدول
  // فارغ منذ إنشائه — فمن يدفع يرى «لا توجد فواتير بعد». شكا عميلٌ اشترى
  // نقاطاً بمئة وخمسة عشر ريالاً ولم يجد لها أثراً.
  //
  // ولا يوقف فشلُها الدفعَ: المال حُصّل والاشتراك فُعّل، والفاتورة سجلٌّ
  // يُستدرك لا شرطٌ للتفعيل.
  try {
    const { createServiceInvoice } = await import("./serviceInvoice");
    await createServiceInvoice({
      userId: payment.userId,
      amount: Number(payment.amount),
      purpose: payment.purpose,
      planName,
      credits: payment.credits ?? null,
      billing: payment.billing ?? null,
      paidAt: new Date(),
    });
  } catch (e) {
    console.warn("[paymentFinalize] تعذّر إنشاء فاتورة الخدمة:", e instanceof Error ? e.message : e);
  }

  // إيصال الدفع/التجديد بالبريد — لا يوقف إتمام الدفع إن فشل الإرسال
  void import("./emailFlows")
    .then(m => m.emailPaymentReceipt(payment.userId, {
      purpose: payment.purpose,
      invoiceId: payment.invoiceId,
      planName,
      billing: payment.billing,
      credits: payment.credits,
      amount: Number(payment.amount),
      // بدونهما يظهر الإجمالي وحده فلا تكون فاتورة ضريبية
      vatAmount: payment.vatAmount == null ? null : Number(payment.vatAmount),
      discountAmount: payment.discountAmount == null ? null : Number(payment.discountAmount),
      paidAt: new Date(),
      periodEnd,
    }))
    .catch(() => {});

  return { status: "paid", purpose: payment.purpose, paymentId: payment.id };
}
