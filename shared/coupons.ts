// ─── حساب خصم الكوبون ─────────────────────────────────────────────────────────
// الخصم يقع على المبلغ **قبل** الضريبة، ثم تُحسب الضريبة على الصافي بعد الخصم.
// العكس (خصم من الإجمالي شاملاً الضريبة) يجعل الضريبة المورَّدة للهيئة أكبر مما
// حُصِّل فعلاً — فرق يخرج من جيبك ولا يظهر إلا عند الإقرار.

import { withVat } from "./tax";

export type CouponType = "percent" | "fixed";
export type CouponScope = "subscription" | "topup" | "both";

export type CouponLike = {
  type: CouponType;
  /** نسبة مئوية (1..100) أو مبلغ بالريال */
  value: number;
  scope: CouponScope;
  minAmountSar?: number | null;
  maxUses?: number | null;
  usedCount?: number | null;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  isActive?: boolean | null;
};

export type CouponCheck =
  | { ok: true }
  | { ok: false; reason: string };

/** توحيد شكل الكود: يُدخل بأي حالة ومسافات ويُخزَّن ويُقارن بشكل واحد */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function checkCoupon(
  coupon: CouponLike,
  ctx: { scope: Exclude<CouponScope, "both">; netSar: number; now?: Date },
): CouponCheck {
  const now = ctx.now ?? new Date();
  if (coupon.isActive === false) return { ok: false, reason: "هذا الكوبون غير مفعّل" };
  if (coupon.scope !== "both" && coupon.scope !== ctx.scope) {
    return { ok: false, reason: coupon.scope === "topup" ? "هذا الكوبون لشحن النقاط فقط" : "هذا الكوبون للاشتراكات فقط" };
  }
  if (coupon.validFrom && now < new Date(coupon.validFrom)) return { ok: false, reason: "لم يبدأ سريان هذا الكوبون بعد" };
  if (coupon.validUntil && now > new Date(coupon.validUntil)) return { ok: false, reason: "انتهت صلاحية هذا الكوبون" };
  if (coupon.maxUses != null && (coupon.usedCount ?? 0) >= coupon.maxUses) {
    return { ok: false, reason: "استُنفد عدد مرات استخدام هذا الكوبون" };
  }
  if (coupon.minAmountSar != null && ctx.netSar < coupon.minAmountSar) {
    return { ok: false, reason: `هذا الكوبون لمبلغ ${coupon.minAmountSar} ريال فأكثر` };
  }
  return { ok: true };
}

/**
 * يطبّق الخصم على مبلغ صافٍ (بلا ضريبة) ويعيد التفصيل الكامل.
 * الخصم لا يتجاوز المبلغ نفسه: كوبون بمبلغ ثابت أكبر من الفاتورة يجعلها صفراً
 * ولا يقلبها إلى رصيد دائن — لا يوجد مسار لإعادة أموال هنا.
 */
export function applyCoupon(netSar: number, coupon: CouponLike) {
  const base = Math.round(netSar * 100) / 100;
  const raw = coupon.type === "percent"
    ? base * (Math.min(Math.max(coupon.value, 0), 100) / 100)
    : Math.max(coupon.value, 0);
  const discount = Math.min(Math.round(raw * 100) / 100, base);
  const netAfter = Math.round((base - discount) * 100) / 100;
  const { vat, total } = withVat(netAfter);
  return { netBefore: base, discount, net: netAfter, vat, total };
}
