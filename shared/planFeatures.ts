// ─── مصفوفة مزايا الباقات ─────────────────────────────────────────────────────
// مصدر واحد لما تشمله كل باقة: تعرضه صفحة الأسعار، ويُحقن في سياق وكيل المبيعات.
// لو تُرك لكل جهة أن تصف الباقات بنفسها لقال الوكيل شيئاً وعرضت الصفحة غيره —
// وكلام وكيل المبيعات وعدٌ يُحاسَب عليه، لا وصفاً تقريبياً.

export type PlanFeature = {
  key: string;
  label: string;
  /** الباقات التي تشمله، بالمعرّف */
  includedIn: number[];
  /** تعريف مختصر يظهر عند الحاجة */
  hint?: string;
};

/** معرّفات الباقات كما في قاعدة البيانات */
export const PLAN_IDS = { basic: 1, pro: 2, enterprise: 3, expert: 4 } as const;

export const PLAN_FEATURES: PlanFeature[] = [
  { key: "agent_chat", label: "محادثة الوكيل المحاسبي", includedIn: [1, 2, 3] },
  { key: "invoices", label: "إنشاء وترحيل فواتير المبيعات", includedIn: [1, 2, 3] },
  { key: "purchase", label: "فواتير المشتريات", includedIn: [1, 2, 3] },
  { key: "payments", label: "سندات القبض والصرف", includedIn: [2, 3] },
  { key: "journal", label: "القيود اليومية", includedIn: [2, 3] },
  { key: "reports", label: "التقارير المالية", includedIn: [1, 2, 3] },
  { key: "doc_ocr", label: "قراءة الفواتير من صورة", includedIn: [2, 3] },
  { key: "voice", label: "الإدخال الصوتي", includedIn: [2, 3] },
  { key: "multi_user", label: "مستخدمون متعددون بصلاحيات", includedIn: [2, 3] },
  { key: "odoo", label: "دعم Odoo إلى جانب ERPNext", includedIn: [1, 2, 3, 4] },
  { key: "zatca_check", label: "فحص اكتمال بيانات الفاتورة الضريبية", includedIn: [1, 2, 3, 4] },
  { key: "cfo", label: "رؤى المدير المالي (تحليل استراتيجي)", includedIn: [3] },
  { key: "direct_support", label: "دعم شخصي مباشر", includedIn: [3, 4] },
  // مزايا باقة الخبير — لا تتوفر في باقات المحاسبة
  { key: "assessment", label: "تقييم النظام وتقرير مفصّل", includedIn: [4] },
  { key: "handover", label: "بنود استلام وتسليم من المورّد", includedIn: [4] },
  { key: "workflows", label: "تصميم وتنفيذ دورات العمل", includedIn: [4] },
  { key: "policies", label: "كتابة السياسات والإجراءات", includedIn: [4] },
  { key: "print_formats", label: "تصميم نماذج طباعة المستندات", includedIn: [4] },
];

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
  const yes = featuresFor(plan.id).map(f => f.label);
  const no = PLAN_FEATURES.filter(f => !f.includedIn.includes(plan.id)).map(f => f.label);
  return [
    `• ${plan.nameAr} — ${Number(plan.price)} ريال/شهر (السعر لا يشمل ضريبة القيمة المضافة 15%)`,
    plan.monthlyCredits ? `  الرصيد الشهري: ${plan.monthlyCredits} نقطة` : "",
    `  تشمل: ${yes.join("، ") || "—"}`,
    `  لا تشمل: ${no.join("، ") || "—"}`,
  ].filter(Boolean).join("\n");
}
