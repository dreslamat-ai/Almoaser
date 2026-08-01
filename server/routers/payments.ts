// ─── راوتر المدفوعات: اشتراكات وشحن نقاط عبر MyFatoorah ─────────────────────
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getPlanById, getSubscriptionByUserId } from "../db";
import { payments } from "../../drizzle/schema";
import { createPaymentLink, getPaymentStatus, isMyFatoorahConfigured } from "../myfatoorah";
import { yearlyPrice, topupPriceSAR, isValidTopupCredits, TOPUP_MIN_CREDITS, TOPUP_MAX_CREDITS } from "../credits";
import { withVat } from "../../shared/tax";
import { resolveCoupon, recordRedemption } from "../couponService";
import { finalizePaymentByReference } from "../paymentFinalize";

function appBaseUrl(reqOrigin?: string): string {
  return reqOrigin || "https://erpsys.cloud";
}

export const paymentsRouter = router({
  // هل بوابة الدفع مفعّلة؟ (لعرض/إخفاء أزرار الدفع في الواجهة)
  isConfigured: protectedProcedure.query(() => ({ configured: isMyFatoorahConfigured() })),

  // إنشاء دفعة اشتراك (شهري أو سنوي بخصم 15%) — لمالك الحساب فقط
  createSubscriptionPayment: protectedProcedure
    .input(z.object({ planId: z.number(), billing: z.enum(["monthly", "yearly"]), couponCode: z.string().trim().max(40).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.orgRole !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "إدارة الفوترة متاحة لمالك الحساب فقط" });
      }
      const plan = await getPlanById(input.planId);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "الباقة غير موجودة" });
      const monthly = Number(plan.price);
      const listed = input.billing === "yearly" ? yearlyPrice(monthly, plan.yearlyDiscountPct) : monthly;
      // الأسعار معلنة بلا ضريبة وتُضاف عند التحصيل — amount هو المبلغ المحصَّل
      // فعلاً ليطابق كشف البوابة، وvatAmount يفصل الجزء الذي ليس إيراداً.
      // الخصم قبل الضريبة — التفصيل من نفس الدالة التي تعرضه الواجهة
      const applied = input.couponCode
        ? await resolveCoupon({ code: input.couponCode, userId: ctx.user.id, scope: "subscription", netSar: listed })
        : null;
      if (applied && !applied.ok) throw new TRPCError({ code: "BAD_REQUEST", message: applied.reason });
      const priced = applied?.ok ? applied.coupon : withVat(listed);
      const { vat, total: amount } = priced;
      const discountAmount = applied?.ok ? applied.coupon.discount : 0;

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      const inserted = await db.insert(payments).values({
        userId: ctx.user.id,
        purpose: "subscription",
        planId: plan.id,
        billing: input.billing,
        amount: String(amount),
        vatAmount: String(vat),
        couponId: applied?.ok ? applied.coupon.id : null,
        discountAmount: discountAmount ? String(discountAmount) : null,
        status: "pending",
      });
      const paymentId = Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0);
      if (applied?.ok) {
        // بعد إنشاء الدفعة لا قبلها: كوبون يُحسب استخدامه على دفعة لم تُنشأ يضيع هباءً
        await recordRedemption({ couponId: applied.coupon.id, userId: ctx.user.id, paymentId, discountSar: discountAmount });
      }

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

  // إنشاء دفعة شحن نقاط (أي عدد ابتداءً من الحد الأدنى، بسعر ريال للنقطة) — لمالك الحساب فقط
  createTopupPayment: protectedProcedure
    .input(z.object({ credits: z.number().int().min(TOPUP_MIN_CREDITS).max(TOPUP_MAX_CREDITS), couponCode: z.string().trim().max(40).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.orgRole !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "إدارة الفوترة متاحة لمالك الحساب فقط" });
      }
      if (!isValidTopupCredits(input.credits)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `أقل شحنة ${TOPUP_MIN_CREDITS} نقطة` });
      }
      const sub = await getSubscriptionByUserId(ctx.user.id);
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "يجب الاشتراك في باقة أولاً" });
      const listedTopup = topupPriceSAR(input.credits);
      const applied = input.couponCode
        ? await resolveCoupon({ code: input.couponCode, userId: ctx.user.id, scope: "topup", netSar: listedTopup })
        : null;
      if (applied && !applied.ok) throw new TRPCError({ code: "BAD_REQUEST", message: applied.reason });
      const priced = applied?.ok ? applied.coupon : withVat(listedTopup);
      const { vat, total: amount } = priced;
      const discountAmount = applied?.ok ? applied.coupon.discount : 0;

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      const inserted = await db.insert(payments).values({
        userId: ctx.user.id,
        purpose: "topup",
        credits: input.credits,
        amount: String(amount),
        vatAmount: String(vat),
        couponId: applied?.ok ? applied.coupon.id : null,
        discountAmount: discountAmount ? String(discountAmount) : null,
        status: "pending",
      });
      const paymentId = Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0);
      if (applied?.ok) {
        await recordRedemption({ couponId: applied.coupon.id, userId: ctx.user.id, paymentId, discountSar: discountAmount });
      }

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
  // (نفس منطق التفعيل يُنفَّذ أيضاً تلقائياً عبر webhook حتى لو لم يعد العميل لهذه الصفحة)
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
      const result = await finalizePaymentByReference(status);
      return {
        status: (result.status === "already_paid" ? "paid" : result.status === "not_found" ? "failed" : result.status) as "paid" | "failed",
        purpose: result.purpose ?? payment.purpose,
      };
    }),

  // سجل مدفوعات المنظمة (مالك الحساب — نفس مصدر الفوترة لكل أعضاء المنظمة)
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db || !ctx.effectiveUserId) return [];
    const { desc } = await import("drizzle-orm");
    return db.select().from(payments).where(eq(payments.userId, ctx.effectiveUserId)).orderBy(desc(payments.createdAt)).limit(30);
  }),
});
