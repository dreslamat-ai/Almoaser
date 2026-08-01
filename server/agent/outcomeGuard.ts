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

/**
 * اسم الأداة كما يفهمه محاسب لا كما نسمّيه في الكود.
 *
 * الملخّص يُقرأ من عميل، وسطرٌ فيه delete_document يجعله يبحث عن معنى بدل أن
 * يقرأ نتيجة. ما ليس في الجدول يُعرض بصيغة عامة لا بمعرّفه البرمجي.
 */
const TOOL_LABELS: Record<string, string> = {
  get_invoices: "عرض الفواتير", get_invoice_detail: "قراءة تفاصيل فاتورة",
  get_customers: "عرض العملاء", get_items: "عرض الأصناف", get_suppliers: "عرض الموردين",
  get_accounts: "عرض شجرة الحسابات", get_payments: "عرض الدفعات",
  get_journal_entries: "عرض القيود", get_sales_report: "تقرير المبيعات",
  get_settings: "قراءة الإعدادات", list_documents: "البحث في المستندات",
  print_document: "طباعة مستند", check_tax_setup: "فحص الإعداد الضريبي",
  create_invoice: "إنشاء فاتورة مبيعات", create_purchase_invoice: "إنشاء فاتورة مشتريات",
  create_payment_entry: "تسجيل دفعة", create_journal_entry: "إنشاء قيد يومية",
  create_customer: "إنشاء عميل", create_item: "إنشاء صنف", create_supplier: "إنشاء مورّد",
  update_customer: "تعديل عميل", update_document: "تعديل مستند", update_settings: "تعديل الإعدادات",
  submit_invoice: "اعتماد فاتورة", submit_document: "اعتماد مستند",
  cancel_document: "إلغاء مستند", delete_document: "حذف مستند",
  setup_tax_settings: "ضبط الإعداد الضريبي", create_custom_field: "إضافة حقل مخصص",
  create_print_format: "إنشاء نموذج طباعة", create_workflow: "إنشاء دورة عمل",
  platform_activate_subscription: "تفعيل اشتراك", platform_grant_credits: "منح نقاط",
  platform_extend_subscription: "تمديد اشتراك", platform_create_coupon: "إنشاء كوبون",
  platform_set_coupon_active: "تغيير حالة كوبون", platform_set_user_active: "تغيير حالة حساب",
  platform_set_lead_status: "تحديث عميل محتمل",
};

export function labelFor(toolName: string): string {
  return TOOL_LABELS[toolName] ?? "عملية على النظام";
}

/** يقصّ الرسالة الطويلة: العميل يحتاج السبب لا سجلّ الخادم */
function briefError(e?: string): string {
  const t = (e ?? "").trim();
  if (!t) return "فشل بلا سبب معلن";
  return t.length > 220 ? t.slice(0, 217) + "…" : t;
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
    const lines = failed.map(f => `• ${labelFor(f.name)}: ${briefError(f.error)}`).join("\n");
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
      + ok.map(o => `• ${labelFor(o.name)}`).join("\n");
  }
  if (!ok.length) {
    return `⚠️ **لم يكتمل التنفيذ.**\n`
      + bad.map(o => `• ${labelFor(o.name)}: ${briefError(o.error)}`).join("\n");
  }
  // عمليات القراءة لا تُعرض في الملخّص: نجاح "عرض العملاء" ليس إنجازاً يُبلَّغ
  // به، وذكرُه يدفن السطر الوحيد المهم — ما لم ينجح.
  const okWrites = ok.filter(o => isMutating(o.name));
  return (okWrites.length ? `تمّ جزء من الطلب دون بقيته:\n\n**نجح:**\n`
      + okWrites.map(o => `• ${labelFor(o.name)}`).join("\n") + `\n\n**لم ينجح:**\n`
      : `⚠️ **لم يكتمل التنفيذ.**\n\n`)
    + bad.map(o => `• ${labelFor(o.name)}: ${briefError(o.error)}`).join("\n");
}
