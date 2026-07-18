// ─── راوتر المدفوعات: اشتراكات وشحن نقاط عبر MyFatoorah ─────────────────────
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getPlanById, getSubscriptionByUserId, updateSubscription } from "../db";
import { payments } from "../../drizzle/schema";
import { createPaymentLink, getPaymentStatus, isMyFatoorahConfigured } from "../myfatoorah";
import { yearlyPrice, topupPriceSAR, isValidTopupCredits, addTopupCredits } from "../credits";

function appBaseUrl(reqOrigin?: string): string {
  return reqOrigin || "https://almoaser.manus.space";
}

export const paymentsRouter = router({
  // هل بوابة الدفع مفعّلة؟ (لعرض/إخفاء أزرار الدفع في الواجهة)
  isConfigured: protectedProcedure.query(() => ({ configured: isMyFatoorahConfigured() })),

  // إنشاء دفعة اشتراك (شهري أو سنوي بخصم 15%)
  createSubscriptionPayment: protectedProcedure
    .input(z.object({ planId: z.number(), billing: z.enum(["monthly", "yearly"]) }))
    .mutation(async ({ ctx, input }) => {
      const plan = await getPlanById(input.planId);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "الباقة غير موجودة" });
      const monthly = Number(plan.price);
      const amount = input.billing === "yearly" ? yearlyPrice(monthly, plan.yearlyDiscountPct) : monthly;

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      const inserted = await db.insert(payments).values({
        userId: ctx.user.id,
        purpose: "subscription",
        planId: plan.id,
        billing: input.billing,
        amount: String(amount),
        status: "pending",
      });
      const paymentId = Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0);

      const origin = (ctx.req.headers.origin as string) || undefined;
      const base = appBaseUrl(origin);
      const link = await createPaymentLink({
        amount,
        customerName: ctx.user.name || "عميل",
        customerEmail: ctx.user.email || undefined,
        reference: String(paymentId),
        description: `اشتراك ${plan.nameAr} — ${input.billing === "yearly" ? "سنوي (خصم 15%)" : "شهري"}`,
        callbackUrl: `${base}/payment/callback`,
        errorUrl: `${base}/payment/callback?failed=1`,
      });
      await db.update(payments).set({ invoiceId: String(link.InvoiceId), paymentUrl: link.InvoiceURL }).where(eq(payments.id, paymentId));
      return { paymentUrl: link.InvoiceURL, paymentId };
    }),

  // إنشاء دفعة شحن نقاط (مضاعفات 100 نقطة، كل 100 نقطة = 100 ريال)
  createTopupPayment: protectedProcedure
    .input(z.object({ credits: z.number().int().min(100).max(10000) }))
    .mutation(async ({ ctx, input }) => {
      if (!isValidTopupCredits(input.credits)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الشحن يكون بمضاعفات 100 نقطة" });
      }
      const sub = await getSubscriptionByUserId(ctx.user.id);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "يجب الاشتراك في باقة أولاً" });
      const amount = topupPriceSAR(input.credits);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      const inserted = await db.insert(payments).values({
        userId: ctx.user.id,
        purpose: "topup",
        credits: input.credits,
        amount: String(amount),
        status: "pending",
      });
      const paymentId = Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0);

      const origin = (ctx.req.headers.origin as string) || undefined;
      const base = appBaseUrl(origin);
      const link = await createPaymentLink({
        amount,
        customerName: ctx.user.name || "عميل",
        customerEmail: ctx.user.email || undefined,
        reference: String(paymentId),
        description: `شحن ${input.credits} نقطة رصيد`,
        callbackUrl: `${base}/payment/callback`,
        errorUrl: `${base}/payment/callback?failed=1`,
      });
      await db.update(payments).set({ invoiceId: String(link.InvoiceId), paymentUrl: link.InvoiceURL }).where(eq(payments.id, paymentId));
      return { paymentUrl: link.InvoiceURL, paymentId };
    }),

  // التحقق من الدفع بعد العودة من بوابة الدفع وتفعيل الاشتراك/النقاط
  verifyPayment: protectedProcedure
    .input(z.object({ mfPaymentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const status = await getPaymentStatus(input.mfPaymentId, "PaymentId");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });

      const internalId = Number(status.CustomerReference ?? 0);
      const rows = await db.select().from(payments).where(eq(payments.id, internalId)).limit(1);
      const payment = rows[0];
      if (!payment || payment.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "عملية الدفع غير موجودة" });
      }
      if (payment.status === "paid") {
        return { status: "paid" as const, purpose: payment.purpose };
      }
      if (status.InvoiceStatus !== "Paid") {
        await db.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
        return { status: "failed" as const, purpose: payment.purpose };
      }

      // الدفع ناجح → التفعيل
      await db.update(payments).set({ status: "paid", paidAt: new Date() }).where(eq(payments.id, payment.id));
      if (payment.purpose === "subscription" && payment.planId) {
        const plan = await getPlanById(payment.planId);
        const sub = await getSubscriptionByUserId(ctx.user.id);
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
        await addTopupCredits(ctx.user.id, payment.credits, `شحن ${payment.credits} نقطة عبر MyFatoorah`);
      }
      return { status: "paid" as const, purpose: payment.purpose };
    }),

  // سجل مدفوعات المستخدم
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const { desc } = await import("drizzle-orm");
    return db.select().from(payments).where(eq(payments.userId, ctx.user.id)).orderBy(desc(payments.createdAt)).limit(30);
  }),
});
