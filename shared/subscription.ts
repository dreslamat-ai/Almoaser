/** حساب الأيام المتبقية في فترة التجربة (يُقرَّب لأعلى). يرجع 0 إذا انتهت */
export function trialDaysLeft(endDate: Date | string | null | undefined, now: Date = new Date()): number {
  if (!endDate) return 0;
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
