// ─── حالة تعيش خارج الذاكرة وخارج قاعدة البيانات ────────────────────────────
//
// ما يحتاج البقاء بين إعادات التشغيل ولا يستحقّ جدولاً وهجرةً على إنتاج حيّ:
// «أنذرتُ عن هذا» و«ذكّرني بعد ثلاث ساعات». ملفٌّ يكفي.
//
// **ولماذا داخل مجلّد التطبيق:** كان مسار الحالة `/home/eipsys/...` — وبيت
// eipsys صلاحيته `drwxr-x--x` لغير مالكه، والتطبيق يعمل بمستخدم آخر. فكانت
// كل كتابةٍ تفشل، والفشل مُلتقَط بـ`catch` يطبع تحذيراً ويمضي. فبدت المشكلة
// محلولةً وهي لم تُحلّ: القراءة تُرجع فارغاً دائماً، وتكرار التنبيهات الذي
// عولج بهذا الملفّ كان مستمرّاً طوال الوقت.
//
// **ولهذا يصرخ هذا الملفّ عند الإقلاع إن تعذّرت الكتابة.** تخزينٌ يفشل بصمت
// أسوأ من غيابه: غيابُه معلوم، وفشلُه الصامت يُطمئن كذباً.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";

const DIR = process.env.STATE_DIR ?? join(process.cwd(), ".runtime-state");

export function statePath(name: string): string {
  return join(DIR, name);
}

// **الصلاحية 2775 لا الافتراضية:** المجلّد قد يُنشئه شخصٌ من فريق التطوير
// بينما يكتب فيه التطبيقُ بمستخدم آخر من المجموعة نفسها. بلا كتابةٍ للمجموعة
// وبلا setgid يُنشأ مملوكاً لمن أنشأه فيعجز التطبيق عن الكتابة — وهو بالضبط
// ما وقع أوّل مرّة، فصرخ الفحص أدناه.
const ensureDir = (d: string) => mkdirSync(d, { recursive: true, mode: 0o2775 });

/**
 * يتحقّق مرّة عند الإقلاع أن مجلّد الحالة قابل للكتابة فعلاً.
 *
 * ويجرّب بنفس طريقة الكتابة الحقيقية — ملفٌّ مؤقّت ثم `rename` — لا بالكتابة
 * فوق ملفٍّ قائم. الفرق ليس شكلياً: ملفٌّ خلّفه مستخدمٌ آخر من الفريق يمنع
 * `writeFileSync` فوقه ولا يمنع `rename` عليه، لأن الأخير يحتاج صلاحية
 * المجلّد لا صلاحية الملفّ. فحصٌ أشدّ من الواقع يُنذر عن عطلٍ غير موجود.
 */
export function assertStateWritable(): void {
  if (!writeState(".write-probe", Date.now())) {
    console.error(
      `[stateFile] ✗ مجلّد الحالة ${DIR} غير قابل للكتابة.\n` +
      "           التنبيهات ستتكرّر والتذكيرات ستضيع. اضبط STATE_DIR على مسارٍ يملكه مستخدم التطبيق.",
    );
  }
}

export function readState<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(statePath(name), "utf8")) as T;
  } catch {
    // أول تشغيل أو ملفٌّ معطوب: نبدأ نظيفاً بدل أن نتعطّل
    return fallback;
  }
}

/**
 * كتابة ذرّية: ملفّ مؤقّت ثم `rename`. الكتابة المباشرة تترك ملفّاً مبتوراً
 * لو أُعيد التشغيل في أثنائها، فيُقرأ في المرّة التالية كأنه لا شيء —
 * ويضيع كل ما سُجّل قبله.
 */
export function writeState(name: string, value: unknown): boolean {
  const target = statePath(name);
  try {
    ensureDir(dirname(target));
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), "utf8");
    renameSync(tmp, target);
    return true;
  } catch (e) {
    console.warn(`[stateFile] تعذّر حفظ ${name}:`, e instanceof Error ? e.message : e);
    return false;
  }
}
