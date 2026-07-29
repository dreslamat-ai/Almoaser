// ─── مهام دورية خفيفة (بديل عن cron خارجي) ────────────────────────────────────
// تُشغَّل داخل نفس عملية السيرفر عبر setInterval — كافية لحجم المنصة الحالي
// ولا تحتاج بنية تحتية إضافية (worker/queue منفصل)
import { checkExpiringSubscriptions } from "./notifications";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // كل 6 ساعات

export function startScheduledJobs(): void {
  const run = () => {
    checkExpiringSubscriptions().catch(err =>
      console.warn("[scheduler] checkExpiringSubscriptions failed:", err instanceof Error ? err.message : err)
    );
  };
  // تشغيل أول فحص بعد دقيقة من الإقلاع (بعد استقرار الاتصال بقاعدة البيانات)
  setTimeout(run, 60 * 1000);
  setInterval(run, CHECK_INTERVAL_MS);
}
