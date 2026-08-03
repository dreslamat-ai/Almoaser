// ─── تذكيرات يجدولها المالك بنفسه من تليجرام ─────────────────────────────────
//
// طلبه: «ذكّرني كل ٣ ساعات». وكان ردّ الوكيل أنه لا يملك أداةً لذلك، فيُطلب
// من صاحب المنصّة أن يفتح المحادثة ويسأل بنفسه كل مرّة — وهو عكس الغرض من
// مساعدٍ نشط.
//
// **ملفّ لا جدول:** المنصّة على إنتاج حيّ وقاعدةُ بياناتها لا تُهاجَر إلا
// يدوياً بعد نسخة احتياطية. والتذكيرات قليلة العدد ويملكها شخص واحد، فملفٌّ
// في مجلّد الحالة يكفي ولا يستحقّ هجرةً على عملاء يعملون.
//
// **ويُحسب الموعد التالي من الآن لا من الموعد الفائت:** لو توقّفت العملية
// ستّ ساعات، فتذكيرٌ كل ثلاث لا يجوز أن يصل مرّتين متلاحقتين ليقضي دَينه.
// التذكير المتأخّر يُرسل مرّة، ثم يُستأنف من هذه اللحظة.
import { readState, writeState } from "./stateFile";

const FILE = "reminders.json";

export type Reminder = {
  id: number;
  text: string;
  /** التكرار بالساعات — غائبٌ في التذكير مرّة واحدة */
  everyHours?: number;
  /** موعد الإرسال القادم، ISO */
  nextAt: string;
  createdAt: string;
};

type State = { seq: number; items: Reminder[] };

const load = (): State => readState<State>(FILE, { seq: 0, items: [] });
const save = (s: State): boolean => writeState(FILE, s);

export function listReminders(): Reminder[] {
  return load().items.sort((a, b) => a.nextAt.localeCompare(b.nextAt));
}

/**
 * يجدول تذكيراً.
 *
 * @param text       ما يُقال عند حلول الموعد
 * @param everyHours التكرار بالساعات (١ إلى ١٦٨) — أو لا شيء لمرّة واحدة
 * @param afterHours بعد كم ساعة أوّل إرسال (افتراضه = التكرار، أو ساعة)
 */
export function addReminder(text: string, everyHours?: number, afterHours?: number): Reminder | { error: string } {
  const t = text.trim();
  if (!t) return { error: "نصّ التذكير فارغ" };
  if (everyHours !== undefined && (!Number.isFinite(everyHours) || everyHours < 1 || everyHours > 168)) {
    return { error: "التكرار بالساعات بين ١ و ١٦٨ (أسبوع)" };
  }
  const delay = afterHours ?? everyHours ?? 1;
  if (!Number.isFinite(delay) || delay <= 0 || delay > 8760) return { error: "موعد أوّل إرسال غير معقول" };

  const s = load();
  const r: Reminder = {
    id: ++s.seq,
    text: t,
    ...(everyHours ? { everyHours } : {}),
    nextAt: new Date(Date.now() + delay * 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  s.items.push(r);
  // التذكير الذي لم يُحفظ لن يصل — فلا نقول للمالك إنه جُدول
  if (!save(s)) return { error: "تعذّر حفظ التذكير على القرص — لم يُجدول" };
  return r;
}

export function cancelReminder(id: number): boolean {
  const s = load();
  const before = s.items.length;
  s.items = s.items.filter(r => r.id !== id);
  if (s.items.length === before) return false;
  return save(s);
}

/** التذكيرات المستحقّة الآن — وتُقدَّم مواعيدها أو تُحذف قبل الإرسال */
export function takeDueReminders(now = new Date()): Reminder[] {
  const s = load();
  const due = s.items.filter(r => new Date(r.nextAt) <= now);
  if (!due.length) return [];
  const dueIds = new Set(due.map(r => r.id));
  s.items = s.items
    .filter(r => !dueIds.has(r.id) || r.everyHours)
    .map(r => (dueIds.has(r.id) && r.everyHours
      ? { ...r, nextAt: new Date(now.getTime() + r.everyHours * 3600_000).toISOString() }
      : r));
  // **يُحفظ قبل الإرسال لا بعده:** لو سقطت العملية بينهما، تذكيرٌ فائت أهون
  // من تذكير يتكرّر عند كل إقلاع.
  save(s);
  return due;
}

export function describeReminder(r: Reminder): string {
  const when = new Date(r.nextAt).toLocaleString("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short",
  });
  return `#${r.id} · ${r.text} · ${r.everyHours ? `كل ${r.everyHours} ساعة` : "مرّة واحدة"} · القادم ${when}`;
}
