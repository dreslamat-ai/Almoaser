// ─── تفعيل الدفع بعد التأكد من نجاحه — يُستخدم من verifyPayment (عودة العميل)
// ومن webhook الخاص بـ MyFatoorah (إشعار خادم-لخادم) لضمان عدم ضياع أي دفعة
// حتى لو أغلق العميل المتصفح قبل رجوعه لصفحة الكولباك ───────────────────────────
import { eq } from "drizzle-orm";
import { getDb, getPlanById, getSubscriptionByUserId, updateSubscription } from "./db";
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

  if (payment.purpose === "subscription" && payment.planId) {
    const plan = await getPlanById(payment.planId);
    const sub = await getSubscriptionByUserId(payment.userId);
    const periodMs = payment.billing === "yearly" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    if (sub) {
      await updateSubscription(sub.id, {
        planId: payment.planId,
        status: "active",
        billing: payment.billing ?? "monthly",
        endDate: new Date(Date.now() + periodMs),
        ...(plan ? { creditsBalance: plan.monthlyCredits, creditsCycleStart: new Date() } : {}),
      });
    }
  } else if (payment.purpose === "topup" && payment.credits) {
    await addTopupCredits(payment.userId, payment.credits, `شحن ${payment.credits} نقطة عبر MyFatoorah`);
  }

  return { status: "paid", purpose: payment.purpose, paymentId: payment.id };
}
