// ─── ذاكرة التنبيهات بين إعادات التشغيل ──────────────────────────────────────
//
// **لماذا ملفّ لا متغيّر:** كانت حالة «أُنذر عن هذا» في `Set` بالذاكرة، وكل
// نشر يعيد تشغيل العملية فيمسحها — فيُعاد التنبيه نفسه من أوّله. في يومٍ
// واحد بلغت إعادات التشغيل سبعاً وثمانين، فوصلت رسائل متكرّرة عن حالة واحدة
// لم تتغيّر. والتنبيه المتكرّر عن شيء معروف يُعلّم صاحبه ألّا يقرأ التنبيهات.
//
// وملفٌّ خارج شجرة النشر لا يمسّه `deploy`، ولا يحتاج جدولاً ولا هجرة.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const FILE = process.env.ALERT_STATE_FILE ?? "/home/eipsys/.almoaser-alert-state.json";

type State = Record<string, string>;

function load(): State {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as State;
  } catch {
    //أول تشغيل أو ملفٌّ معطوب: نبدأ نظيفاً بدل أن نتعطّل
    return {};
  }
}

function save(state: State): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(state), "utf8");
  } catch (e) {
    //تعذّر الحفظ لا يمنع التنبيه — أسوأ ما يقع تكرارٌ، وهو أهون من صمت
    console.warn("[alertState] تعذّر الحفظ:", e instanceof Error ? e.message : e);
  }
}

/**
 * هل يجوز التنبيه عن هذا المفتاح الآن؟
 *
 * @param key    ما يُنذَر عنه — «balance:openrouter» أو «unbilled:shahd»
 * @param window بصمة النافذة: ساعةٌ للرصيد، وقيمةٌ ثابتة لما يُنذَر عنه مرّة
 * @returns true إن لم يُنذر عنه في هذه النافذة — ويُسجَّل فوراً
 */
export function shouldAlert(key: string, window: string): boolean {
  const state = load();
  if (state[key] === window) return false;
  state[key] = window;
  save(state);
  return true;
}

/** يُنسى المفتاح فيُنذَر عنه من جديد إن عاد — يُستدعى حين يعود الوضع سليماً */
export function forgetAlert(key: string): void {
  const state = load();
  if (!(key in state)) return;
  delete state[key];
  save(state);
}

/** يُتراجع عن التسجيل حين يفشل الإرسال، فلا يضيع التنبيه بصمت */
export function undoAlert(key: string): void {
  forgetAlert(key);
}
