// ─── حدود محادثة الوكيل ───────────────────────────────────────────────────────
// المتصفح هو من يرسل تاريخ المحادثة كاملاً مع كل طلب، والخصم نقطة واحدة مهما
// كان حجمه. بلا هذه الحدود يستطيع أي عميل إرسال تاريخ ضخم فيتحمّل الحساب تكلفة
// نموذج كبيرة مقابل نقطة واحدة — والقياس على الاستخدام الفعلي أن البرومبت وحده
// ‏~11,872 توكن في المتوسط، فالسقف ليس ترفاً.

/** أقصى طول لرسالة واحدة */
export const MAX_MESSAGE_CHARS = 4000;
/** أقصى عدد رسائل يقبلها الطلب أصلاً (حدّ إساءة، لا حدّ تشغيل) */
export const MAX_MESSAGES = 200;
/** عدد الرسائل الأخيرة التي تُرسل فعلاً للنموذج */
export const HISTORY_WINDOW = 24;
/** رسالة أطول من هذا تكلّف نقطتين بدل واحدة */
export const LONG_MESSAGE_CHARS = 1500;

type ChatMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

/**
 * يقصّ التاريخ إلى آخر HISTORY_WINDOW رسالة، لكن عند حدّ آمن.
 *
 * القصّ الساذج يكسر الطلب: رسالة tool يجب أن تسبقها رسالة assistant تحمل
 * tool_calls المطابقة، فلو وقع القصّ بينهما رفض النموذج الطلب كله. لذلك نتقدّم
 * بالبداية إلى أول رسالة user — فهي وحدها بداية صالحة لا تعتمد على ما قبلها.
 *
 * لو لم توجد رسالة user داخل النافذة أُعيد التاريخ كما هو: محادثة مشروعة طويلة
 * أولى بأن تكلّف قليلاً من أن تُكسر.
 */
export function trimHistory<T extends ChatMessage>(messages: T[], window = HISTORY_WINDOW): T[] {
  if (messages.length <= window) return messages;
  const tail = messages.slice(-window);
  const firstUser = tail.findIndex(m => m.role === "user");
  if (firstUser < 0) return messages;
  return tail.slice(firstUser);
}

/** تكلفة الرسالة بالنقاط — الطويلة بنقطتين */
export function messageCreditCost(content: string): number {
  return content.length > LONG_MESSAGE_CHARS ? 2 : 1;
}
