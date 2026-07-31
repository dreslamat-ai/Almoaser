// ─── الأرقام العربية (الهندية) ────────────────────────────────────────────────
// الواجهة عربية، والأرقام الهندية هي المألوفة لقارئها. لكن الحساب والتخزين
// والإرسال للسيرفر يجب أن يبقى بأرقام لاتينية، وإلا صار الرقم نصاً لا يُجمع.
// لذلك: التحويل للعرض فقط، والتطبيع عند القراءة من أي إدخال.

const ARABIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** للعرض: 1234 → ١٢٣٤ (ما ليس رقماً يمر كما هو، فالفواصل والعملة تبقى) */
export function toArabicDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, d => ARABIC[Number(d)]);
}

/**
 * للقراءة: يقبل ما يكتبه المستخدم بأي من الأنظمة الثلاثة ويعيده لاتينياً.
 * لوحات المفاتيح العربية تُدخل ٠-٩ والفارسية ۰-۹، وكلاهما يجب أن يُفهم — وإلا
 * بدا للمستخدم أن ما كتبه لم يُسجَّل.
 */
export function toLatinDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const ai = ARABIC.indexOf(ch);
    const pi = PERSIAN.indexOf(ch);
    if (ai >= 0) out += String(ai);
    else if (pi >= 0) out += String(pi);
    else out += ch;
  }
  return out;
}

/** يستخرج الأرقام وحدها من إدخال حرّ (بأي نظام) — للحقول الرقمية */
export function digitsOnly(input: string): string {
  return toLatinDigits(input).replace(/\D/g, "");
}
