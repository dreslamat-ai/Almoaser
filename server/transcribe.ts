// ─── تفريغ الصوت إلى نصّ ─────────────────────────────────────────────────────
//
// رسالةٌ صوتية على تيليجرام كانت تُهمَل تماماً: المعالج يقرأ `text` وحده،
// فمن يسجّل مقطعاً لا يرى ردّاً ولا خطأً — كأن شيئاً لم يصل.
//
// **ولا يُخمَّن ما لم يُسمع.** إن تعذّر التفريغ يُقال ذلك؛ ومهمّةٌ تُنشأ من
// نصٍّ مخمَّن أسوأ من مهمّة لم تُنشأ.
const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Transcript = { ok: true; text: string; via: string } | { ok: false; error: string };

/** حدّ تيليجرام للتنزيل ٢٠ ميجابايت، وWhisper ٢٥ — الأصغر يحكم */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * يُفرّغ مقطعاً صوتياً.
 *
 * يُجرَّب Whisper أولاً لأنه الأدقّ في العربية المنطوقة بلهجات، ثم نموذجٌ
 * متعدّد الوسائط عبر OpenRouter إن لم يكن مفتاح OpenAI مضبوطاً.
 */
export async function transcribeAudio(bytes: Buffer, mime = "audio/ogg"): Promise<Transcript> {
  if (bytes.length > MAX_BYTES) return { ok: false, error: "المقطع أطول من الحدّ المسموح" };

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    try {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), "voice.ogg");
      form.append("model", "whisper-1");
      //اللغة تُصرَّح: بلا تصريحها يُخطئ النموذج أحياناً فيفرّغ العربية حروفاً لاتينية
      form.append("language", "ar");
      const res = await fetch(WHISPER_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json()) as { text?: string; error?: { message?: string } };
      if (res.ok && body.text?.trim()) return { ok: true, text: body.text.trim(), via: "whisper-1" };
      return { ok: false, error: body.error?.message?.slice(0, 140) ?? `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 140) : "تعذّر التفريغ" };
    }
  }

  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!orKey) return { ok: false, error: "لا مفتاح تفريغ مضبوط (OPENAI_API_KEY)" };

  try {
    const b64 = bytes.toString("base64");
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${orKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "فرّغ هذا المقطع الصوتي إلى نصّ عربي حرفياً. أعِد النصّ وحده بلا مقدّمة ولا شرح." },
            { type: "input_audio", input_audio: { data: b64, format: "ogg" } },
          ],
        }],
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (res.ok && text) return { ok: true, text, via: "gemini-2.5-flash" };
    return { ok: false, error: body.error?.message?.slice(0, 140) ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 140) : "تعذّر التفريغ" };
  }
}

/** ينزّل ملفاً من تيليجرام بمعرّفه */
export async function downloadTelegramFile(fileId: string): Promise<{ ok: true; bytes: Buffer; mime: string } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: false, error: "تيليجرام غير مضبوط" };

  try {
    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const info = (await infoRes.json()) as { ok?: boolean; result?: { file_path?: string }; description?: string };
    const path = info.result?.file_path;
    if (!info.ok || !path) return { ok: false, error: info.description?.slice(0, 120) ?? "تعذّر جلب الملف" };

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!fileRes.ok) return { ok: false, error: `تنزيل الملف ${fileRes.status}` };

    const bytes = Buffer.from(await fileRes.arrayBuffer());
    const mime = path.endsWith(".oga") || path.endsWith(".ogg") ? "audio/ogg"
      : path.endsWith(".m4a") ? "audio/m4a" : "audio/mpeg";
    return { ok: true, bytes, mime };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 120) : "تعذّر التنزيل" };
  }
}
