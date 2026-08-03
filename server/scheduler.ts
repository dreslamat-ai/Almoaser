// ─── مهام دورية خفيفة (بديل عن cron خارجي) ────────────────────────────────────
// تُشغَّل داخل نفس عملية السيرفر عبر setInterval — كافية لحجم المنصة الحالي
// ولا تحتاج بنية تحتية إضافية (worker/queue منفصل)
import { checkExpiringSubscriptions } from "./notifications";
import { sendLeadDigest } from "./leadFollowUp";
import { alertIfLowBalance } from "./providerBalance";
import { getUnbilledApps, BILLED_APPS } from "./llmUsage";
import { checkErpConnections } from "./erpHealth";
import { maybeSendDailyReport } from "./dailyReport";

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
  startUnbilledWatch();
  startErpHealthWatch();
  startDailyReport();
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

// ─── تطبيق جديد ينفق من مفتاحنا ──────────────────────────────────────────────
// **خارج المقارنة عن قصد، لا خارج العلم.** تكلفة أي تطبيق غير سارة لا تُحمَّل
// على هامش هذه المنصة لأن إيراده ليس هنا — لكن أن يمرّ شهر وأحدٌ ينفق من
// مفتاحنا بلا أن يظهر في حساب أسوأ من ضمّه خطأً. يُنبَّه مرة لكل تطبيق جديد.


function startUnbilledWatch(): void {
  const tick = async () => {
    try {
      const apps = await getUnbilledApps(30);
      const { shouldAlert, undoAlert } = await import("./alertState");
      //«once» نافذةٌ ثابتة: يُنذَر عن التطبيق مرّة واحدة لا مرّة لكل نشر
      const fresh = apps.filter(a => shouldAlert(`unbilled:${a.app}`, "once"));
      if (!fresh.length) return;

      const { sendTelegram } = await import("./telegram");

      const lines = fresh.map(a => `• ${a.app}: $${a.costUsd.toFixed(4)} · ${a.calls} استدعاء`);
      const r = await sendTelegram(
        `ℹ️ تطبيق ينفق من مفتاح النماذج وهو <b>خارج</b> المقارنة المالية\n\n${lines.join("\n")}\n\n` +
        `المحسوب على إيراد المنصة: ${BILLED_APPS.join("، ")}\n` +
        `تفاصيله في لوحة الأدمن ← تفاصيل النماذج. لضمّه للمقارنة أضِفه إلى BILLED_APPS.`,
        { disablePreview: true },
      );
      if (!r.ok) {
        //لم يصل التنبيه: تُنسى العلامة ليُعاد في الدورة التالية
        for (const a of fresh) { undoAlert(`unbilled:${a.app}`); }
        console.warn("[scheduler] تعذّر التنبيه عن تطبيق غير محسوب:", r.error);
      } else {
        console.log(`[scheduler] تطبيقات خارج المقارنة: ${fresh.map(a => a.app).join("، ")}`);
      }
    } catch (e) {
      console.warn("[scheduler] فحص التطبيقات غير المحسوبة فشل:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => { void tick(); }, 3 * 60 * 1000);
  setInterval(() => { void tick(); }, 6 * 60 * 60 * 1000);
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

// ─── صحّة اتصالات العملاء بـERPNext ──────────────────────────────────────────
//
// **لماذا وُجد هذا:** عميلٌ حقيقي أمضى جلسة كاملة يحاول إضافة عميل وإنشاء
// فاتورة، والوكيل يردّ في كل مرة بأن بيانات الدخول غير صحيحة. لم يكن أحد
// يعلم. وحين فُحصت الاتصالات كلها وُجد اثنان معطوبان من ستة — بلا أي أثر في
// أي سجل، ولا شكوى إلا من واحد تكلّم.
//
// الاعتماد يقع مرة واحدة عند الحفظ ثم لا يُعاد أبداً، وكلمة السرّ تتغيّر على
// الطرف الآخر بلا أن تُخبرنا. فيُفحص دورياً: من ينكسر نعرفه قبل أن يشتكي.
const ERP_HEALTH_MS = 6 * 60 * 60 * 1000;


function startErpHealthWatch(): void {
  const tick = async () => {
    try {
      const { broken, ok, healthyIds } = await checkErpConnections();

      const { shouldAlert, undoAlert, forgetAlert } = await import("./alertState");

      //من عاد يعمل تُنسى علامته، فيُنذَر عنه من جديد إن انكسر ثانيةً.
      //بلا هذا يُنذَر مرّة واحدة في عمر النظام ثم يصمت عن كل انكسار تالٍ.
      for (const id of healthyIds) forgetAlert(`erp:${id}`);

      const fresh = broken.filter(b => shouldAlert(`erp:${b.id}`, "broken"));
      if (!fresh.length) {
        if (broken.length) console.log(`[erpHealth] ${broken.length} اتصال معطوب (أُنذر عنها)`);
        return;
      }

      const { sendTelegram } = await import("./telegram");

      const lines = fresh.map(b => `• ${b.email} — ${b.url}\n  ${b.reason}`);
      const r = await sendTelegram(
        `🔴 اتصال عميل بـERPNext لا يعمل\n\n${lines.join("\n\n")}\n\n` +
        `سليم ${ok} · معطوب ${broken.length}\n` +
        `العميل يرى «تعذّر الوصول إلى النظام» في كل محاولة، ولا يستطيع إنشاء شيء.`,
        { disablePreview: true },
      );
      if (!r.ok) {
        for (const b of fresh) undoAlert(`erp:${b.id}`);
        console.warn("[erpHealth] تعذّر التنبيه:", r.error);
      }
    } catch (e) {
      console.warn("[erpHealth] الفحص فشل:", e instanceof Error ? e.message : e);
    }
  };
  setTimeout(() => { void tick(); }, 4 * 60 * 1000);
  setInterval(() => { void tick(); }, ERP_HEALTH_MS);
}

// ─── تقرير الصباح ────────────────────────────────────────────────────────────
// يُفحص كل ربع ساعة ويُرسل مرّة واحدة عند التاسعة — نفس نمط تذكير العملاء
// المحتملين، فما ثبت أنه يعمل لا يُعاد اختراعه.
function startDailyReport(): void {
  const tick = async () => {
    const r = await maybeSendDailyReport().catch(e => ({ sent: false, reason: e instanceof Error ? e.message : "خطأ" }));
    if (r.sent) console.log("[scheduler] أُرسل تقرير الصباح");
    else if (r.reason && !["خارج الموعد", "أُرسل اليوم"].includes(r.reason)) {
      console.warn("[scheduler] لم يُرسل تقرير الصباح:", r.reason);
    }
  };
  setInterval(() => { void tick(); }, 15 * 60 * 1000);
}
