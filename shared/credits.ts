// تسعير وحدود شحن النقاط — مشتركة عمداً بين الواجهة والسيرفر.
// الواجهة تعرض السعر وتمنع ما دون الحد الأدنى، والسيرفر يحسب المبلغ المُحصَّل
// ويرفض غير الصالح؛ لو تفرّق الرقمان عرضت الواجهة سعراً لا يُحصَّل فعلاً.

/** كم نقطة يشتريها الريال الواحد */
export const CREDITS_PER_SAR = 5;
/** أقل عدد نقاط يمكن شحنه في المرة الواحدة (٥٠٠ نقطة = ١٠٠ ريال) */
export const TOPUP_MIN_CREDITS = 500;
/** سقف الشحنة الواحدة */
export const TOPUP_MAX_CREDITS = 10000;

/**
 * سعر عدد من النقاط بالريال السعودي.
 * يُقرَّب إلى منزلتين لأن عمود المبلغ decimal(10,2) — ولئلا تُسرِّب القسمة
 * العشرية أرقاماً مثل 27.400000000000002 إلى بوابة الدفع.
 */
export function topupPriceSAR(credits: number): number {
  return Math.round((credits / CREDITS_PER_SAR) * 100) / 100;
}

/** للعرض: يحذف الصفر العشري الزائد فيظهر ١٠ لا ١٠٫٠٠ */
export function formatSAR(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(2)));
}
