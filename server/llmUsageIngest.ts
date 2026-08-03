// ─── استقبال استهلاك النماذج من تطبيق خارجي ──────────────────────────────────
//
// شهد تعيش في مشروع آخر (AlmoaserPos، PHP، قاعدة بيانات أخرى) وتنادي النماذج
// **بمفتاح OpenRouter نفسه**. فما تعرضه لوحة المزوّد مجموعُ الاثنين لا يُفصل،
// وسجلّنا لا يعرف عنها شيئاً. هذه النقطة تجعلها تُبلّغ بما أنفقت، فيصير السؤال
// «مين بيستهلك إيه؟» له جواب في مكان واحد.
//
// **سرٌّ مشترك لا مصادقة مستخدم:** المُبلِّغ خادمٌ لا شخص، ولا جلسة له. ويُقارَن
// السرّ بمقارنة ثابتة الزمن — المقارنة العادية تُسرّب طول البادئة الصحيحة.
//
// ولا يُقبل تبليغٌ يحمل تكلفةً جاهزة: التكلفة تُحسب هنا من التوكنز بتسعيرنا،
// وإلا كتب المُبلِّغ ما شاء في دفتر نفقاتنا.
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { logLlmUsage } from "./llmUsage";

/** سقف التبليغات في الدقيقة من مصدر واحد — يمنع إغراق الجدول */
const MAX_PER_MINUTE = 240;
const seen: number[] = [];

function withinRate(): boolean {
  const now = Date.now();
  while (seen.length && now - seen[0] > 60_000) seen.shift();
  if (seen.length >= MAX_PER_MINUTE) return false;
  seen.push(now);
  return true;
}

function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function registerLlmUsageIngest(app: Express): void {
  app.post("/api/llm-usage", async (req: Request, res: Response) => {
    const expected = process.env.LLM_USAGE_INGEST_SECRET?.trim();
    if (!expected) {
      //بلا سرّ مضبوط لا تُفتح النقطة أصلاً: نقطةٌ مفتوحة تكتب في سجل نفقاتنا
      res.status(503).json({ ok: false, error: "ingest disabled" });
      return;
    }

    if (!secretMatches(req.header("X-Usage-Secret")?.trim(), expected)) {
      console.warn("[llmUsageIngest] rejected: bad secret");
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    if (!withinRate()) {
      res.status(429).json({ ok: false, error: "rate limited" });
      return;
    }

    const body = (req.body ?? {}) as {
      app?: unknown; model?: unknown;
      promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown;
    };

    const appName = String(body.app ?? "").trim().slice(0, 40);
    const model = String(body.model ?? "").trim().slice(0, 120);
    const prompt = Number(body.promptTokens ?? 0);
    const completion = Number(body.completionTokens ?? 0);

    if (!appName || !model || !Number.isFinite(prompt) || !Number.isFinite(completion)
        || prompt < 0 || completion < 0) {
      res.status(400).json({ ok: false, error: "bad payload" });
      return;
    }

    //نداءٌ بلا توكنز لا يُسجَّل: صفٌّ بتكلفة صفر يضخّم العدّ ولا يضيف معنى
    if (prompt + completion === 0) {
      res.json({ ok: true, skipped: "no tokens" });
      return;
    }

    await logLlmUsage({
      app: appName,
      //التسعير يُشتقّ من اسم الموديل عندنا، لا من رقم يرسله المُبلِّغ
      provider: `openrouter:${model}`,
      usage: {
        prompt_tokens: Math.round(prompt),
        completion_tokens: Math.round(completion),
        total_tokens: Math.round(Number(body.totalTokens ?? prompt + completion)),
      },
    });

    res.json({ ok: true });
  });
}
