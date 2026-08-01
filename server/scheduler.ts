// ─── مهام دورية خفيفة (بديل عن cron خارجي) ────────────────────────────────────
// تُشغَّل داخل نفس عملية السيرفر عبر setInterval — كافية لحجم المنصة الحالي
// ولا تحتاج بنية تحتية إضافية (worker/queue منفصل)
import { checkExpiringSubscriptions } from "./notifications";
import { sendLeadDigest } from "./leadFollowUp";

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
  startLeadDigest();
}

// ─── تذكير العملاء المحتملين ─────────────────────────────────────────────────
// مرة واحدة يومياً في التاسعة صباحاً بتوقيت الرياض: التذكير الذي يصل ليلاً
// يُقرأ صباحاً وقد فقد يومه، والذي يصل مع بداية العمل يُتصرَّف فيه.
//
// **مرة واحدة لا مرة لكل إعادة تشغيل**: النشر يعيد تشغيل العملية، ولو أُرسل
// الملخّص عند الإقلاع لوصل عشر مرات في يوم عمل واحد فتوقّف عن قراءته.
const RIYADH_UTC_OFFSET_H = 3;
const DIGEST_HOUR_LOCAL = 9;
let lastDigestDay = "";

function startLeadDigest(): void {
  const tick = async () => {
    const now = new Date();
    const local = new Date(now.getTime() + RIYADH_UTC_OFFSET_H * 3600_000);
    const day = local.toISOString().slice(0, 10);
    if (local.getUTCHours() !== DIGEST_HOUR_LOCAL || lastDigestDay === day) return;
    lastDigestDay = day;
    try {
      const r = await sendLeadDigest();
      if (r.sent) console.log(`[scheduler] تذكير العملاء المحتملين: ${r.count} سجلاً`);
      else if (r.reason) console.log(`[scheduler] لم يُرسل التذكير: ${r.reason}`);
    } catch (e) {
      console.warn("[scheduler] فشل تذكير العملاء المحتملين:", e instanceof Error ? e.message : e);
    }
  };
  // كل ربع ساعة: يكفي لالتقاط الساعة المقصودة بلا استيقاظ لا لزوم له
  setInterval(() => { void tick(); }, 15 * 60 * 1000);
}
