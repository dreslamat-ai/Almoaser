// ─── وصف سعة الباقة للعرض ─────────────────────────────────────────────────────
// باقة الخبير ليست باقة مستندات: لا تُدخل حركات أصلاً، فحدّ المستندات فيها صفر.
// عرضها بنفس قالب باقات المحاسبة يُنتج "0 مستنداً/شهر" — رقم صحيح تقنياً وبلا
// معنى للعميل، بل يوحي بأن الباقة معطّلة. لذا يُوصف كل وضع بما يقيسه فعلاً.

export type PlanLike = {
  mode?: string | null;
  maxDocuments?: number | null;
  monthlyCredits?: number | null;
};

export function isExpertPlan(plan: PlanLike): boolean {
  return plan.mode === "expert";
}

/** سطر السعة المختصر (شارة صغيرة تحت اسم الباقة) */
export function planCapacityLabel(plan: PlanLike): string {
  if (isExpertPlan(plan)) return "تقييم وضبط — بلا إدخال حركات";
  return `${plan.maxDocuments ?? 30} مستنداً / شهر`;
}

/** سطر السعة المفصّل (صفحة التسجيل: مستندات + نقاط) */
export function planCapacityDetail(plan: PlanLike): string {
  if (isExpertPlan(plan)) {
    return `${plan.monthlyCredits ?? 0} نقطة شهرياً · تقييم وضبط بلا إدخال حركات`;
  }
  return `${plan.maxDocuments ?? 30} مستنداً · ${plan.monthlyCredits ?? 150} نقطة شهرياً`;
}
