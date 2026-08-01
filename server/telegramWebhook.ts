// ─── تيليجرام: محادثة النظام من الجوال ──────────────────────────────────────
//
// تكتب للبوت فيردّ المحاسب الذكي — نفس الوكيل ونفس الأدوات ونفس الصلاحيات.
//
// **لا نسخة ثانية من منطق الوكيل.** يُستدعى `agent.chat` عبر createCaller، فما
// يصلح في الموقع يصلح هنا: قواعد الحوكمة، خصم النقاط، ردّها عند الفشل، حدود
// الاشتراك. لو كُتب منطق موازٍ لانحرف الاثنان بعد أول تعديل، وصار الوكيل يتصرّف
// على تيليجرام بغير ما يتصرّف به على الشاشة.
//
// **الأمان:** البوت يستقبل من أي أحد على تيليجرام — من يعرف اسمه يكتب له.
// ولأن الردّ هنا ينفّذ عمليات محاسبية على نظام حقيقي، لا يُقبل إلا معرّف
// المحادثة المضبوط في البيئة. غيره يُردّ بلا تنفيذ ولا كشف عن سبب.

import type { Express, Request, Response } from "express";
import { sendTelegram, tg } from "./telegram";
import { extractQuickReplies } from "./agent/quickReplies";

type TgMessage = {
  message_id: number;
  chat?: { id: number };
  from?: { id: number; first_name?: string };
  text?: string;
};

const MAX_TG_CHARS = 3800; // حد تيليجرام 4096 — نترك هامشاً للوسوم

/**
 * معرّف المحادثة لكل دردشة — والسياق نفسه يُقرأ من قاعدة البيانات لا من هنا.
 *
 * كان السجل كلّه في الذاكرة، فمسحه أول نشر: أكّد المستخدم حذفاً بـ"نعم" فردّ
 * الوكيل أنه لم يُطلب منه حذف شيء في هذه المحادثة. النسيان بين رسالتين في
 * عملية تُتلف بيانات ليس عيب راحة — هو ما يجعل التأكيد بلا معنى.
 *
 * المعرّف وحده يبقى في الذاكرة، وفقدُه يبدأ محادثة جديدة لا يفقد محادثة قائمة.
 */
const threads = new Map<number, { conversationId?: number }>();
const MAX_HISTORY = 16;

/** آخر رسائل المحادثة من القاعدة — تنجو من إعادة التشغيل */
async function loadHistory(conversationId?: number): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (!conversationId) return [];
  const { getMessagesByConversationId } = await import("./db");
  const rows = await getMessagesByConversationId(conversationId).catch(() => []);
  return rows
    .filter(r => r.role === "user" || r.role === "assistant")
    .slice(-MAX_HISTORY)
    .map(r => ({ role: r.role as "user" | "assistant", content: String(r.content ?? "") }))
    .filter(m => m.content.trim().length > 0);
}

function ownerChatId(): number | null {
  const raw = process.env.TELEGRAM_CHAT_ID?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** يقصّ الرد ليمرّ من حدّ تيليجرام بلا أن يُقطع في منتصف وسم HTML */
export function chunkForTelegram(text: string, max = MAX_TG_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    // نقطع عند فاصل سطر إن وُجد قريباً من الحد، وإلا عند الحد
    const cut = rest.lastIndexOf("\n", max);
    const at = cut > max * 0.5 ? cut : max;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * تحويل ردّ الوكيل إلى نصّ تيليجرام.
 *
 * ماركداون الوكيل (**غامق** و`كود`) لا يُفهم هنا، فيصل بنجومه ظاهرة. والتحويل
 * يهرّب المحارف أولاً كي لا يُفسّر اسم عميل فيه قوس زاوية كوسم.
 */
export function agentReplyToTelegram(reply: string): string {
  const escaped = tg(reply);
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    // السطر يُزال هنا أيضاً احتياطاً: المستخرِج يتولاه عادةً، لكن ردّاً وصل من
    // مسار آخر يجب ألّا يكشف تعليمات الواجهة للمستخدم
    .replace(/\[QUICK_REPLIES:[^\]]*\]/g, "")
    .trim();
}

export function registerTelegramWebhook(app: Express): void {
  app.post("/api/webhooks/telegram", async (req: Request, res: Response) => {
    // نردّ 200 فوراً: تيليجرام يعيد الإرسال إن تأخّر الرد، ومعالجة الوكيل
    // تستغرق ثوانٍ — فبلا هذا تصل الرسالة مرتين وتُخصم نقطتان.
    res.status(200).json({ ok: true });

    try {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
      if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
        console.warn("[telegram] رُفض طلب بترويسة سرّ غير مطابقة");
        return;
      }

      const msg = (req.body as { message?: TgMessage })?.message;
      const chatId = msg?.chat?.id;
      const text = msg?.text?.trim();
      if (!chatId || !text) return;

      const owner = ownerChatId();
      if (owner === null || chatId !== owner) {
        // لا نكشف أن هناك مالكاً ولا لماذا رُفض — البوت عام والرسالة قد تكون فحصاً
        await sendTelegram("هذا البوت مخصص لإشعارات المعاصر AI الداخلية.").catch(() => {});
        return;
      }

      if (text === "/start" || text === "/help") {
        await sendTelegram(
          "<b>المحاسب الذكي</b>\nاكتب طلبك مباشرة وسأنفّذه على نظامك:\n\n"
          + "• اعرض آخر ١٠ فواتير\n• أنشئ فاتورة لعميل\n• كم رصيد العميل فلان؟\n\n"
          + "<code>/new</code> يبدأ محادثة جديدة.",
        );
        return;
      }
      if (text === "/new") {
        threads.delete(chatId);
        await sendTelegram("بدأنا محادثة جديدة ✅");
        return;
      }

      await handleOwnerMessage(chatId, text);
    } catch (e) {
      console.error("[telegram] فشل معالجة التحديث:", e instanceof Error ? e.message : e);
    }
  });
}

async function handleOwnerMessage(chatId: number, text: string): Promise<void> {
  const { getDb } = await import("./db");
  const db = await getDb();
  if (!db) { await sendTelegram("تعذّر الوصول لقاعدة البيانات الآن."); return; }

  // المالك هو صاحب معرّف المحادثة المضبوط — يُقرأ من نفس جدول المستخدمين كي
  // تسري عليه الصلاحيات والاشتراك مثل أي مستخدم لا كاستثناء
  const { users } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const ownerEmail = process.env.TELEGRAM_OWNER_EMAIL?.trim();
  const rows = ownerEmail
    ? await db.select().from(users).where(eq(users.email, ownerEmail)).limit(1)
    : await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  const user = rows[0];
  if (!user) { await sendTelegram("لم أجد حساب المالك — اضبط TELEGRAM_OWNER_EMAIL."); return; }

  const thread = threads.get(chatId) ?? {};
  const history = [...(await loadHistory(thread.conversationId)), { role: "user" as const, content: text }];

  const { appRouter } = await import("./routers");
  const { resolveOrgOwnerId } = await import("./organizations");

  // سياق مكتمل بمستخدم حقيقي: نفس ما يبنيه الموقع، لا التفاف حول الصلاحيات
  const caller = appRouter.createCaller({
    req: { headers: {} } as never,
    res: undefined as never,
    user,
    effectiveUserId: await resolveOrgOwnerId(user),
  });

  try {
    const r = await caller.agent.chat({
      messages: history,
      conversationId: thread.conversationId,
    } as never) as { reply: string; conversationId?: number; quickReplies?: string[] };

    // الوكيل يحفظ الرسالتين في القاعدة، فلا نكرّرهما هنا — نحتفظ بالمعرّف فقط
    thread.conversationId = r.conversationId ?? thread.conversationId;
    threads.set(chatId, thread);

    // الخيارات تُؤخذ من حقلها في الرد لا تُستخرج من نصّه: agent.chat ينزع سطر
    // العلامة قبل أن يعيد `reply`، فمحاولة استخراجه بعدها ترجع فارغة دائماً —
    // وهو سبب غياب الأزرار عن تيليجرام بينما كانت تظهر في الموقع.
    // ويبقى الاستخراج احتياطاً لردٍّ وصل من مسار لا ينزعه.
    const quickReplies = r.quickReplies?.length
      ? r.quickReplies
      : extractQuickReplies(r.reply).quickReplies;
    const parts = chunkForTelegram(agentReplyToTelegram(r.reply));

    // نتيجة الإرسال تُفحص: فشلٌ صامت هنا يعني أن العميل نفّذ عملية على نظامه
    // ولم يصله تأكيدها — وهو أسوأ من فشل معلن، لأنه سيعيد الطلب ظانّاً أنه لم يتم.
    for (let i = 0; i < parts.length; i++) {
      // الأزرار مع الجزء الأخير وحده: لو رافقت كل جزء لتكرّرت اللوحة
      const isLast = i === parts.length - 1;
      const sent = await sendTelegram(parts[i], isLast ? { quickReplies } : {});
      if (!sent.ok) {
        console.error("[telegram] تعذّر تسليم رد الوكيل:", sent.error);
        break;
      }
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : "خطأ غير معروف";
    await sendTelegram(`تعذّر تنفيذ الطلب: ${tg(reason)}`);
  }
}
