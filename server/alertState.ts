// ─── ذاكرة التنبيهات بين إعادات التشغيل ──────────────────────────────────────
//
// **لماذا ملفّ لا متغيّر:** كانت حالة «أُنذر عن هذا» في `Set` بالذاكرة، وكل
// نشر يعيد تشغيل العملية فيمسحها — فيُعاد التنبيه نفسه من أوّله. في يومٍ
// واحد بلغت إعادات التشغيل سبعاً وثمانين، فوصلت رسائل متكرّرة عن حالة واحدة
// لم تتغيّر. والتنبيه المتكرّر عن شيء معروف يُعلّم صاحبه ألّا يقرأ التنبيهات.
//
// **وموضع الملفّ ليس تفصيلاً:** كان في بيت مستخدمٍ آخر لا يملك التطبيقُ
// الكتابةَ فيه، فظلّت كل كتابةٍ تفشل بصمت وظلّ التكرار قائماً بعد «إصلاحه».
// المسار الآن من `stateFile` الذي يتحقّق من ذلك عند الإقلاع ويصرخ إن عجز.
import { readState, writeState } from "./stateFile";

const FILE = "alerts.json";

type State = Record<string, string>;

const load = (): State => readState<State>(FILE, {});
const save = (state: State): void => { writeState(FILE, state); };

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
