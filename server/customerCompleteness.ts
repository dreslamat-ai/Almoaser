// ─── اكتمال بيانات العميل قبل إصدار فاتورة ضريبية ────────────────────────────
// الفاتورة الضريبية في السعودية تتطلب بيانات مشترٍ محددة. إصدارها ناقصة يعني
// فاتورة غير مستوفية لدى هيئة الزكاة والضريبة والجمارك — والمسؤولية على البائع
// لا على النظام الذي أصدرها. لذلك المنع هنا في الكود لا في نص التوجيه وحده.
//
// **ما نتحقق منه هو الاكتمال لا الصحة.** لا توجد واجهة رسمية للتحقق من أن رقماً
// ضريبياً مسجَّل فعلاً (راجع server/taxId.ts) — نتحقق من الصيغة والوجود فقط،
// ولا يجوز أن يقال للعميل إن بياناته "تحققت لدى الهيئة".

export type MissingField =
  | "tax_id" | "address" | "address_city" | "address_country" | "postal_code";

export type CustomerDoc = {
  customer_name?: string | null;
  customer_type?: string | null;
  tax_id?: string | null;
  customer_primary_address?: string | null;
};

export type AddressDoc = {
  address_line1?: string | null;
  city?: string | null;
  country?: string | null;
  pincode?: string | null;
} | null;

export type CompletenessResult = {
  complete: boolean;
  /** ما يمنع الإصدار */
  missing: MissingField[];
  /** ما ينقص لكن لا يمنع — يُبلَّغ العميل به */
  warnings: MissingField[];
  isIndividual: boolean;
};

export const FIELD_LABELS: Record<MissingField, string> = {
  tax_id: "الرقم الضريبي للعميل",
  address: "عنوان العميل (الشارع/المبنى)",
  address_city: "المدينة",
  address_country: "الدولة",
  postal_code: "الرمز البريدي",
};

/**
 * الفاتورة المبسّطة (لفرد) لا تستلزم بيانات مشترٍ كاملة، بخلاف الفاتورة
 * الضريبية للمنشآت. لذلك نوع العميل يحدّد الصرامة.
 */
export function inspectCustomerCompleteness(
  customer: CustomerDoc,
  address: AddressDoc,
): CompletenessResult {
  const isIndividual = (customer.customer_type ?? "Company") === "Individual";
  const missing: MissingField[] = [];
  const warnings: MissingField[] = [];

  if (!isIndividual) {
    if (!customer.tax_id?.trim()) missing.push("tax_id");
    if (!address || !address.address_line1?.trim()) missing.push("address");
    else {
      if (!address.city?.trim()) missing.push("address_city");
      if (!address.country?.trim()) missing.push("address_country");
      // الرمز البريدي جزء من العنوان الوطني لكنه لا يُعطّل الإصدار
      if (!address.pincode?.trim()) warnings.push("postal_code");
    }
  }

  return { complete: missing.length === 0, missing, warnings, isIndividual };
}

/** نص عربي بما ينقص — يُعرض للعميل كما هو */
export function describeMissing(missing: MissingField[]): string {
  return missing.map(m => FIELD_LABELS[m]).join("، ");
}
