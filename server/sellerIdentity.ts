// ─── بيانات البائع (المعاصر) للفواتير الضريبية ───────────────────────────────
//
// تُقرأ من البيئة لا من الكود: بيانات كهذه تتغيّر (عنوان، رقم تسجيل) ولا يصحّ
// أن يحتاج تغييرها إصداراً جديداً. ولأنها تظهر على كل فاتورة تصل لعميل، تُفحص
// مرة عند القراءة بدل أن تُطبع ناقصة أو خاطئة.
//
// المصدر: شهادة التسجيل في ضريبة القيمة المضافة الصادرة من الهيئة.

import { validateTaxId } from "./taxId";

export type SellerIdentity = {
  legalName: string;
  vatNumber: string;
  address: string;
  crNumber?: string;
};

export type SellerIdentityState =
  | { configured: true; seller: SellerIdentity }
  | { configured: false; missing: string[] };

const FIELDS: Array<[env: string, label: string]> = [
  ["COMPANY_LEGAL_NAME", "الاسم القانوني"],
  ["COMPANY_VAT_NUMBER", "رقم التسجيل الضريبي"],
  ["COMPANY_ADDRESS", "العنوان الوطني"],
];

/**
 * بيانات البائع إن اكتملت، أو قائمة الناقص.
 *
 * الفاتورة الضريبية تلزم بالثلاثة معاً، فإصدارها بواحد ناقص يُنتج مستنداً غير
 * مستوفٍ — والاكتشاف يكون عند الفحص لا عند الإصدار. لذلك الغياب يُبلَّغ صراحةً
 * ولا يُستبدل بقيمة افتراضية.
 */
export function getSellerIdentity(): SellerIdentityState {
  const missing: string[] = [];
  for (const [env, label] of FIELDS) {
    if (!process.env[env]?.trim()) missing.push(label);
  }
  if (missing.length) return { configured: false, missing };

  const vatNumber = process.env.COMPANY_VAT_NUMBER!.trim();
  // الرقم يُفحص شكلياً هنا أيضاً: خطأ مطبعي في البيئة يظهر على كل فاتورة
  const check = validateTaxId(vatNumber, "SA");
  if (!check.valid) {
    return { configured: false, missing: [`رقم التسجيل الضريبي غير صحيح الصيغة (${check.reason})`] };
  }

  return {
    configured: true,
    seller: {
      legalName: process.env.COMPANY_LEGAL_NAME!.trim(),
      vatNumber: check.normalized,
      address: process.env.COMPANY_ADDRESS!.trim(),
      crNumber: process.env.COMPANY_CR_NUMBER?.trim() || undefined,
    },
  };
}

/** هل يمكن إصدار فاتورة ضريبية معتمدة الآن؟ */
export function canIssueTaxInvoice(): boolean {
  return getSellerIdentity().configured;
}
