// ─── مهام دورية خفيفة (بديل عن cron خارجي) ────────────────────────────────────
// تُشغَّل داخل نفس عملية السيرفر عبر setInterval — كافية لحجم المنصة الحالي
// ولا تحتاج بنية تحتية إضافية (worker/queue منفصل)
import { checkExpiringSubscriptions } from "./notifications";
import { sendLeadDigest } from "./leadFollowUp";
import { alertIfLowBalance } from "./providerBalance";

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
  startBalanceWatch();
}

// ─── مراقبة رصيد المزوّدين ───────────────────────────────────────────────────
// **كل ساعة لا كل ست:** نفاد الرصيد يوقف سارة وشهد معاً في اللحظة نفسها، ولا
// يسبقه تحذير من المزوّد. ستّ ساعاتٍ بين فحصين تعني أن يقف المنتجان ستّ ساعات
// قبل أن يعلم أحد. والدالة نفسها لا تُرسل أكثر من إنذار في الساعة لكل مزوّد،
// فالتكرار هنا لا يُغرق أحداً.
const BALANCE_CHECK_MS = 60 * 60 * 1000;

function startBalanceWatch(): void {
  const tick = () => {
    alertIfLowBalance()
      .then(sent => { if (sent.length) console.log(`[scheduler] أُنذر عن رصيد: ${sent.join("، ")}`); })
      .catch(e => console.warn("[scheduler] فحص الرصيد فشل:", e instanceof Error ? e.message : e));
  };
  //بعد دقيقتين من الإقلاع: بعد استقرار الشبكة، وقبل أن يمضي وقت طويل
  setTimeout(tick, 2 * 60 * 1000);
  setInterval(tick, BALANCE_CHECK_MS);
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
      if (r.sent) console.log(`[scheduler] تذكير العملاء المحتملين: ${r.count} سجلاً عبر ${r.via.join(" و ")}`);
      else if (r.reason) console.log(`[scheduler] لم يُرسل التذكير: ${r.reason}`);
    } catch (e) {
      console.warn("[scheduler] فشل تذكير العملاء المحتملين:", e instanceof Error ? e.message : e);
    }
  };
  // كل ربع ساعة: يكفي لالتقاط الساعة المقصودة بلا استيقاظ لا لزوم له
  setInterval(() => { void tick(); }, 15 * 60 * 1000);
}
