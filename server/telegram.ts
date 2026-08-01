// ─── تيليجرام: إشعارات التشغيل لصاحب المنصة ─────────────────────────────────
//
// هذا ليس بوت العملاء (لكل عميل بوته في إعدادات القنوات) — هذه قناة داخلية
// تصل إلى جوالك أنت: عميل محتمل ينتظر، عطل في مزوّد النموذج، دفعة اكتملت.
//
// **لماذا تيليجرام بدل البريد:** البريد يُقرأ مرة أو مرتين يومياً ويُصفّى،
// والتذكير الذي يصل بعد ساعات فقد يومه. والرسالة هنا تصل حيث تُقرأ في دقائق.
// البريد يبقى بديلاً لا مستبدَلاً: لو تعطّل تيليجرام لا يضيع التنبيه بصمت.

export type TelegramResult = { ok: true } | { ok: false; error: string };

const API = "https://api.telegram.org";

function creds(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

export function isTelegramConfigured(): boolean {
  return creds() !== null;
}

/**
 * سبب الرفض كما ذكره تيليجرام لا كما نخمّنه.
 *
 * أخطاؤه الشائعة لها معانٍ مختلفة تماماً: توكن خاطئ شيء، وبوت لم يبدأ العميل
 * محادثته شيء آخر لا يُحلّ بتغيير التوكن. عرض الرمز وحده يترك صاحبه يجرّب
 * الحل الخطأ.
 */
function explain(status: number, description?: string): string {
  const d = (description ?? "").toLowerCase();
  if (d.includes("bot token") || status === 401) {
    return "توكن البوت غير صحيح — انسخه من BotFather كاملاً";
  }
  if (d.includes("chat not found")) {
    return "معرّف المحادثة غير صحيح، أو لم تبدأ محادثة مع البوت بعد — أرسل /start للبوت أولاً";
  }
  if (d.includes("blocked")) return "البوت محظور من هذه المحادثة — أزل الحظر ثم أعد المحاولة";
  if (status === 429) return "طلبات كثيرة متتالية — انتظر قليلاً";
  return description ? `رفض تيليجرام الطلب (${status}): ${description}` : `فشل الإرسال (${status})`;
}

/**
 * لوحة أزرار من خيارات الوكيل.
 *
 * ReplyKeyboard لا InlineKeyboard: الضغط على الأول يرسل النص كرسالة عادية —
 * وهو بالضبط ما يفعله الزر في الموقع. الثاني يرسل callback يحتاج مساراً آخر
 * ومعالجةً أخرى، فيصير للزر سلوكان مختلفان حسب القناة.
 */
function keyboardFor(options: string[]): Record<string, unknown> {
  if (!options.length) {
    // إزالة صريحة: بلا هذا تبقى أزرار السؤال السابق معروضة تحت ردٍّ لا علاقة
    // له بها، فيضغط صاحبها إجابةً عن سؤال انتهى.
    return { remove_keyboard: true };
  }
  return {
    // صفٌّ لكل خيار: النصوص العربية تطول، وصفّان في سطر يقصّان الكلام
    keyboard: options.map(o => [{ text: o }]),
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "أو اكتب طلبك…",
  };
}

/** إرسال رسالة. HTML لا Markdown: الأخير يكسر عند أي شرطة سفلية في اسم عميل. */
export async function sendTelegram(
  text: string,
  opts: { disablePreview?: boolean; quickReplies?: string[] } = {},
): Promise<TelegramResult> {
  const c = creds();
  if (!c) return { ok: false, error: "تيليجرام غير مضبوط (TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID)" };
  try {
    const res = await fetch(`${API}/bot${c.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: c.chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: opts.disablePreview ?? true },
        ...(opts.quickReplies ? { reply_markup: keyboardFor(opts.quickReplies) } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      return { ok: false, error: explain(res.status, body.description) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `تعذّر الوصول إلى تيليجرام: ${e instanceof Error ? e.message : "خطأ غير معروف"}` };
  }
}

/** تهريب محارف HTML — اسم عميل فيه < أو & يكسر الرسالة كلها */
export function tg(s: string): string {
  return s.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

/**
 * يستخرج معرّف المحادثة من آخر الرسائل الواردة للبوت.
 *
 * يُستعمل مرة عند الضبط: بدل أن يبحث صاحب المنصة عن رقمه في بوت آخر، يرسل
 * أي رسالة لبوته ثم يُقرأ المعرّف من هنا.
 */
export async function discoverChatId(token: string): Promise<
  { ok: true; chats: Array<{ id: string; title: string }> } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${API}/bot${token.trim()}/getUpdates`);
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<{ message?: { chat?: { id: number; title?: string; first_name?: string; username?: string } } }>;
    };
    if (!res.ok || !body.ok) return { ok: false, error: explain(res.status, body.description) };

    const seen = new Map<string, string>();
    for (const u of body.result ?? []) {
      const chat = u.message?.chat;
      if (!chat) continue;
      seen.set(String(chat.id), chat.title ?? chat.first_name ?? chat.username ?? String(chat.id));
    }
    if (!seen.size) {
      return { ok: false, error: "لا رسائل واردة — أرسل /start للبوت من حسابك ثم أعد المحاولة" };
    }
    return { ok: true, chats: Array.from(seen, ([id, title]) => ({ id, title })) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "خطأ غير معروف" };
  }
}
