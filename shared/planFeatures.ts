// ─── مصفوفة مزايا الباقات ─────────────────────────────────────────────────────
// مصدر واحد لما تشمله كل باقة: تعرضه صفحة الأسعار، ويُحقن في سياق وكيل المبيعات.
// لو تُرك لكل جهة أن تصف الباقات بنفسها لقال الوكيل شيئاً وعرضت الصفحة غيره —
// وكلام وكيل المبيعات وعدٌ يُحاسَب عليه، لا وصفاً تقريبياً.

/**
 * مسار الميزة. باقة الخبير ليست مستوى أعلى من باقات المحاسبة بل خدمة موازية
 * يشترك فيها العميل **إلى جانب** باقته — لذلك لا تُعرض مزاياها مشطوبة على
 * باقات المحاسبة: الشطب يعني "غير متاح في مستواك" ويوحي بترقية غير موجودة.
 */
export type FeatureTrack = "accounting" | "expert" | "both";

export type PlanFeature = {
  key: string;
  label: string;
  /** الباقات التي تشمله، بالمعرّف */
  includedIn: number[];
  track: FeatureTrack;
  /** تعريف مختصر يظهر عند الحاجة */
  hint?: string;
};

/** معرّفات الباقات كما في قاعدة البيانات */
export const PLAN_IDS = { basic: 1, pro: 2, enterprise: 3, expert: 4 } as const;

export const PLAN_FEATURES: PlanFeature[] = [
  { key: "agent_chat", label: "محادثة المحاسب الذكي", includedIn: [1, 2, 3], track: "accounting" },
  { key: "invoices", label: "إنشاء وترحيل فواتير المبيعات", includedIn: [1, 2, 3], track: "accounting" },
  { key: "purchase", label: "فواتير المشتريات", includedIn: [1, 2, 3], track: "accounting" },
  { key: "payments", label: "سندات القبض والصرف", includedIn: [2, 3], track: "accounting" },
  { key: "journal", label: "القيود اليومية", includedIn: [2, 3], track: "accounting" },
  { key: "reports", label: "التقارير المالية", includedIn: [1, 2, 3], track: "accounting" },
  { key: "doc_ocr", label: "قراءة الفواتير من صورة", includedIn: [2, 3], track: "accounting" },
  { key: "voice", label: "الإدخال الصوتي", includedIn: [2, 3], track: "accounting" },
  { key: "multi_user", label: "مستخدمون متعددون بصلاحيات", includedIn: [2, 3], track: "accounting" },
  { key: "odoo", label: "دعم Odoo إلى جانب ERPNext", includedIn: [1, 2, 3, 4], track: "both" },
  { key: "zatca_check", label: "فحص اكتمال بيانات الفاتورة الضريبية", includedIn: [1, 2, 3, 4], track: "both" },
  { key: "cfo", label: "رؤى المدير المالي (تحليل استراتيجي)", includedIn: [3], track: "accounting" },
  { key: "direct_support", label: "دعم شخصي مباشر", includedIn: [3, 4], track: "both" },
  // مزايا باقة الخبير — لا تتوفر في باقات المحاسبة
  { key: "assessment", label: "تقييم النظام وتقرير مفصّل", includedIn: [4], track: "expert" },
  { key: "handover", label: "بنود استلام وتسليم من المورّد", includedIn: [4], track: "expert" },
  { key: "workflows", label: "تصميم وتنفيذ دورات العمل", includedIn: [4], track: "expert" },
  { key: "policies", label: "كتابة السياسات والإجراءات", includedIn: [4], track: "expert" },
  { key: "print_formats", label: "تصميم نماذج طباعة المستندات", includedIn: [4], track: "expert" },
];

/**
 * المزايا التي تُعرض على بطاقة باقة بعينها.
 * الخبير يرى مساره وما يشترك فيه الجميع؛ وباقات المحاسبة ترى مسارها ولا ترى
 * مزايا الخبير أصلاً — لا مشطوبة ولا مذكورة.
 */
export function featuresForCard(planId: number): PlanFeature[] {
  const isExpert = planId === PLAN_IDS.expert;
  return PLAN_FEATURES.filter(f =>
    f.track === "both" || f.track === (isExpert ? "expert" : "accounting"),
  );
}

export function planHasFeature(planId: number, key: string): boolean {
  return PLAN_FEATURES.find(f => f.key === key)?.includedIn.includes(planId) ?? false;
}

export function featuresFor(planId: number): PlanFeature[] {
  return PLAN_FEATURES.filter(f => f.includedIn.includes(planId));
}

/**
 * وصف نصّي للباقة يُحقن في سياق وكيل المبيعات.
 * يُبنى من نفس المصفوفة لا من نص منفصل، فلا يمكن أن يَعِد الوكيل بما لا تعرضه
 * الصفحة ولا العكس.
 */
export function describePlanForSales(plan: { id: number; nameAr: string; price: unknown; monthlyCredits?: number | null }): string {
  // "لا تشمل" تُحسب داخل مسار الباقة فقط: قول إن الأساسية "لا تشمل تصميم
  // دورات العمل" يوحي بأنها نسخة ناقصة من الخبير، والخبير خدمة موازية تُشترى
  // إلى جانبها لا فوقها.
  const scope = featuresForCard(plan.id);
  const yes = scope.filter(f => f.includedIn.includes(plan.id)).map(f => f.label);
  const no = scope.filter(f => !f.includedIn.includes(plan.id)).map(f => f.label);
  return [
    `• ${plan.nameAr} — ${Number(plan.price)} ريال/شهر (السعر لا يشمل ضريبة القيمة المضافة 15%)`,
    plan.monthlyCredits ? `  الرصيد الشهري: ${plan.monthlyCredits} نقطة` : "",
    `  تشمل: ${yes.join("، ") || "—"}`,
    no.length ? `  لا تشمل: ${no.join("، ")}` : "",
  ].filter(Boolean).join("\n");
}
