// ─── مراجعة نتائج التنفيذ قبل تسليم الرد ─────────────────────────────────────
//
// **الحادثة:** أُبلغ عميل بـ"تم تنفيذ الطلب" ولم يُنفَّذ شيء. المصدر لم يكن
// هلوسة من النموذج بل نصّاً ثابتاً في الكود يُعاد حين تنتهي حلقة الأدوات بلا
// ردّ نهائي — يُعلن النجاح بلا أن يقرأ نتيجة أداة واحدة.
//
// **لماذا مراجعٌ حتمي لا نموذج ثانٍ:** إسناد التحقق إلى نموذج آخر يضيف طبقةً
// قادرة على الخطأ نفسه — نموذج يصدّق نموذجاً. المراجعة هنا تقارن **ادّعاء
// النص** بـ**ما رجع من الأدوات فعلاً**: مقارنة لا اجتهاد فيها، ولا يمكن أن
// تُقنَع بما لم يحدث.
//
// القاعدة الوحيدة: لا يُعلَن نجاحٌ لا تسنده نتيجة أداة ناجحة.

export type ToolOutcome = {
  name: string;
  ok: boolean;
  /** رسالة الخطأ كما رجعت — تُعرض للعميل بدل الادّعاء */
  error?: string;
};

/** أدوات تُغيّر حالة النظام: ادّعاء نجاحها هو ما يضرّ */
const MUTATING = /^(create_|update_|delete_|submit_|cancel_|setup_|save_|platform_(activate|grant|extend|create|set)_)/;

export function isMutating(toolName: string): boolean {
  return MUTATING.test(toolName);
}

/**
 * هل رجعت الأداة بنجاح؟
 *
 * ERPNext يردّ أحياناً بحالة 200 وجسمٍ فيه خطأ، ومنفّذنا يغلّف الفشل في
 * `{ error }`. كما أن `needs_clarification` ليس نجاحاً: العملية لم تقع بعد.
 */
export function outcomeOf(name: string, rawJson: string): ToolOutcome {
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); } catch { return { name, ok: false, error: "رد غير مفهوم من الأداة" }; }
  if (!parsed || typeof parsed !== "object") return { name, ok: false, error: "رد فارغ من الأداة" };
  const o = parsed as Record<string, unknown>;
  if (o.error) return { name, ok: false, error: String(o.error) };
  if (o.needs_clarification) return { name, ok: false, error: "الأداة طلبت توضيحاً ولم تنفّذ" };
  if (o.duplicate_prevented) return { name, ok: false, error: "مُنع تكرار — لم يُنشأ سجل جديد" };
  return { name, ok: true };
}

// صيغ إعلان الإنجاز التي يقرأها العميل كتأكيد وقوع الفعل
const SUCCESS_CLAIM = /(تم تنفيذ|تم إنشاء|تم الإنشاء|تم الحذف|تم حذف|تم الاعتماد|تم اعتماد|تم التعديل|تم تعديل|تم الإلغاء|تم إلغاء|تم التفعيل|تم تفعيل|تم الحفظ|تم بنجاح|أنشأتُ|حذفتُ|اعتمدتُ|عدّلتُ|أُنشئت|حُذف|اعتُمد|عُدّل|أُلغي|فُعّل)/;

export function claimsSuccess(text: string): boolean {
  return SUCCESS_CLAIM.test(text);
}

export type Verdict =
  | { ok: true }
  | { ok: false; reason: string; replacement: string };

/**
 * يراجع الرد قبل تسليمه.
 *
 * يمنع حالتين فقط — وكلتاهما وقعت أو كادت:
 * ١) نصٌّ يعلن الإنجاز ولم تنجح أي أداة تُغيّر حالة.
 * ٢) نصٌّ يعلن الإنجاز وقد فشلت أداةٌ فعلاً — فيُخفي الخطأ عن صاحبه.
 *
 * ولا يعترض على الردود الخبرية: من سأل عن قائمة عملاء لا يُنتظر منه تنفيذ.
 */
export function verifyReply(reply: string, outcomes: ToolOutcome[]): Verdict {
  if (!claimsSuccess(reply)) return { ok: true };

  const mutations = outcomes.filter(o => isMutating(o.name));
  const succeeded = mutations.filter(o => o.ok);
  const failed = mutations.filter(o => !o.ok);

  if (succeeded.length > 0 && failed.length === 0) return { ok: true };

  if (failed.length > 0) {
    const lines = failed.map(f => `• ${f.name}: ${f.error ?? "فشل بلا سبب معلن"}`).join("\n");
    return {
      ok: false,
      reason: `ادّعاء نجاح مع فشل ${failed.length} أداة`,
      replacement: `⚠️ **لم يكتمل التنفيذ.**\n\nحاولتُ تنفيذ طلبك ولم ينجح:\n${lines}\n\nلم يتغيّر شيء في نظامك. أخبرني إن أردت أن أعالج السبب أو أجرّب طريقة أخرى.`,
    };
  }

  return {
    ok: false,
    reason: "ادّعاء نجاح بلا أي عملية تنفيذ",
    replacement: "لم أنفّذ أي تغيير على نظامك في هذه الخطوة. وضّح لي المطلوب بالتحديد وسأنفّذه ثم أؤكّد لك النتيجة الفعلية.",
  };
}

/**
 * ملخّص صادق يحلّ محل النصّ الثابت حين تنتهي الحلقة بلا ردّ من النموذج.
 *
 * كان يُعاد "تم تنفيذ الطلب." دائماً — بلا قراءة نتيجة. هنا الملخّص مبنيّ من
 * النتائج نفسها: ما نجح يُذكر، وما فشل يُذكر بسببه، والفراغ يُقال إنه فراغ.
 */
export function summarizeOutcomes(outcomes: ToolOutcome[]): string {
  if (!outcomes.length) {
    return "لم أنفّذ أي عملية. أعد صياغة طلبك من فضلك وسأتولّاه.";
  }
  const ok = outcomes.filter(o => o.ok);
  const bad = outcomes.filter(o => !o.ok);

  if (!bad.length) {
    return `تمّت ${ok.length === 1 ? "العملية" : `${ok.length} عمليات`} على نظامك:\n`
      + ok.map(o => `• ${o.name}`).join("\n");
  }
  if (!ok.length) {
    return `⚠️ **لم يكتمل التنفيذ.**\n`
      + bad.map(o => `• ${o.name}: ${o.error ?? "فشل بلا سبب معلن"}`).join("\n");
  }
  return `تمّ جزء من الطلب دون بقيته:\n\n**نجح:**\n`
    + ok.map(o => `• ${o.name}`).join("\n")
    + `\n\n**لم ينجح:**\n`
    + bad.map(o => `• ${o.name}: ${o.error ?? "فشل بلا سبب معلن"}`).join("\n");
}
