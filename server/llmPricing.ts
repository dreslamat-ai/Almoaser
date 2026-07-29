/**
 * تسعير نماذج الذكاء الاصطناعي — لحساب تكلفة كل استدعاء بالدولار.
 * OpenRouter: نجلب التسعير الفعلي من /api/v1/models (عام، بدون مفتاح) ونخزنه
 * مؤقتاً — أدق من أي رقم نكتبه يدوياً لأن OpenRouter يحدّثه أولاً بأول.
 * OpenAI/builtin: أسعار ثابتة تقريبية (OpenAI لا يوفر API عام للتسعير).
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ساعات

type PricePerToken = { promptPrice: number; completionPrice: number };

let orCache: { at: number; prices: Map<string, PricePerToken> } | null = null;

async function getOpenRouterPricingMap(): Promise<Map<string, PricePerToken>> {
  if (orCache && Date.now() - orCache.at < CACHE_TTL_MS) return orCache.prices;
  const prices = new Map<string, PricePerToken>();
  try {
    const res = await fetch(OPENROUTER_MODELS_URL);
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }>;
      };
      for (const m of data.data ?? []) {
        const prompt = Number(m.pricing?.prompt ?? 0);
        const completion = Number(m.pricing?.completion ?? 0);
        prices.set(m.id, { promptPrice: prompt, completionPrice: completion });
      }
    }
  } catch {
    // تجاهل فشل الجلب — نستخدم الكاش القديم إن وُجد أو نرجع صفراً
  }
  if (prices.size > 0 || !orCache) orCache = { at: Date.now(), prices };
  return orCache.prices;
}

// أسعار OpenAI الثابتة (دولار لكل مليون توكن) — راجع تسعير OpenAI الرسمي دورياً وحدّثها هنا
const OPENAI_PRICING: Record<string, PricePerToken> = {
  "gpt-4.1": { promptPrice: 2 / 1_000_000, completionPrice: 8 / 1_000_000 },
};

/**
 * يحسب تكلفة استدعاء بالدولار بناءً على المزود والموديل وعدد التوكنز.
 * provider بصيغة "openrouter:model-id" أو "openai" أو "builtin".
 */
export async function estimateCostUsd(
  provider: string,
  promptTokens: number,
  completionTokens: number
): Promise<{ model: string; costUsd: number }> {
  if (provider.startsWith("openrouter:")) {
    const model = provider.slice("openrouter:".length);
    const prices = await getOpenRouterPricingMap();
    const p = prices.get(model);
    if (!p) return { model, costUsd: 0 };
    return { model, costUsd: promptTokens * p.promptPrice + completionTokens * p.completionPrice };
  }
  if (provider === "openai") {
    const p = OPENAI_PRICING["gpt-4.1"];
    return { model: "gpt-4.1", costUsd: promptTokens * p.promptPrice + completionTokens * p.completionPrice };
  }
  // builtin — ضمن اشتراك المنصة، لا تكلفة إضافية محسوبة
  return { model: "builtin", costUsd: 0 };
}
