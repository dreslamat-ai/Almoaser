// ─── تسجيل وتلخيص استهلاك نماذج الذكاء الاصطناعي (تكلفة بالدولار) ────────────
import { sql, desc } from "drizzle-orm";
import { getDb } from "./db";
import { llmUsageLog } from "../drizzle/schema";
import { estimateCostUsd } from "./llmPricing";

/** يسجّل استدعاء LLM واحداً بتكلفته التقديرية — لا يوقف الطلب الأصلي عند الفشل. */
export async function logLlmUsage(params: {
  userId?: number;
  provider: string; // "openrouter:model-id" | "openai" | "builtin"
  /** من أنفق — الافتراضي المنصة نفسها */
  app?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const promptTokens = params.usage?.prompt_tokens ?? 0;
    const completionTokens = params.usage?.completion_tokens ?? 0;
    const totalTokens = params.usage?.total_tokens ?? promptTokens + completionTokens;
    const { model, costUsd } = await estimateCostUsd(params.provider, promptTokens, completionTokens);
    const providerName = params.provider.startsWith("openrouter:") ? "openrouter" : params.provider;
    await db.insert(llmUsageLog).values({
      userId: params.userId,
      provider: providerName,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: costUsd.toFixed(6),
      app: (params.app ?? "sara").slice(0, 40),
    });
  } catch (e) {
    console.warn("[llmUsage] failed to log usage:", e instanceof Error ? e.message : e);
  }
}

function rangeSince(hours: number) {
  return sql`${llmUsageLog.createdAt} > (NOW() - INTERVAL ${sql.raw(String(hours))} HOUR)`;
}

/** ملخص تكلفة النماذج (اليوم / الشهر / الإجمالي) مع تفصيل لكل موديل — للوحة الأدمن */
export async function getLlmCostSummary() {
  const db = await getDb();
  if (!db) return { today: 0, last30Days: 0, allTime: 0, byModel: [] as Array<{ model: string; provider: string; costUsd: number; totalTokens: number; calls: number }> };

  const [todayRows, monthRows, allRows, byModelRows] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)` }).from(llmUsageLog).where(rangeSince(24)),
    db.select({ total: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)` }).from(llmUsageLog).where(rangeSince(24 * 30)),
    db.select({ total: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)` }).from(llmUsageLog),
    db
      .select({
        model: llmUsageLog.model,
        provider: llmUsageLog.provider,
        costUsd: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)`,
        totalTokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
        calls: sql<string>`count(*)`,
      })
      .from(llmUsageLog)
      .groupBy(llmUsageLog.model, llmUsageLog.provider)
      .orderBy(desc(sql`sum(${llmUsageLog.costUsd})`)),
  ]);

  return {
    today: Number(todayRows[0]?.total ?? 0),
    last30Days: Number(monthRows[0]?.total ?? 0),
    allTime: Number(allRows[0]?.total ?? 0),
    byModel: byModelRows.map(r => ({
      model: r.model,
      provider: r.provider,
      costUsd: Number(r.costUsd),
      totalTokens: Number(r.totalTokens),
      calls: Number(r.calls),
    })),
  };
}

/**
 * الاستهلاك موزّعاً على التطبيقات، ولكل تطبيق موديلاته.
 *
 * يجيب سؤال «مين بيستهلك إيه؟» الذي لا تجيبه لوحة المزوّد: المفتاح مشترك
 * بين سارة وشهد، فكل ما يعرضه OpenRouter مجموعٌ واحد.
 */
export async function getLlmUsageByApp(days = 30) {
  const db = await getDb();
  if (!db) return [] as Array<{ app: string; costUsd: number; totalTokens: number; calls: number; models: Array<{ model: string; provider: string; costUsd: number; totalTokens: number; calls: number }> }>;

  const rows = await db
    .select({
      app: llmUsageLog.app,
      model: llmUsageLog.model,
      provider: llmUsageLog.provider,
      costUsd: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)`,
      totalTokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
      calls: sql<string>`count(*)`,
    })
    .from(llmUsageLog)
    .where(rangeSince(24 * days))
    .groupBy(llmUsageLog.app, llmUsageLog.model, llmUsageLog.provider)
    .orderBy(desc(sql`sum(${llmUsageLog.costUsd})`));

  const byApp = new Map<string, { app: string; costUsd: number; totalTokens: number; calls: number; models: Array<{ model: string; provider: string; costUsd: number; totalTokens: number; calls: number }> }>();
  for (const r of rows) {
    const key = r.app ?? "sara";
    if (!byApp.has(key)) byApp.set(key, { app: key, costUsd: 0, totalTokens: 0, calls: 0, models: [] });
    const entry = byApp.get(key)!;
    const cost = Number(r.costUsd);
    const tokens = Number(r.totalTokens);
    const calls = Number(r.calls);
    entry.costUsd += cost;
    entry.totalTokens += tokens;
    entry.calls += calls;
    entry.models.push({ model: r.model, provider: r.provider, costUsd: cost, totalTokens: tokens, calls });
  }

  return Array.from(byApp.values()).sort((a, b) => b.costUsd - a.costUsd);
}

/** آخر حركات استهلاك النماذج (للتفصيل عند الحاجة) */
export async function getRecentLlmUsage(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(llmUsageLog).orderBy(desc(llmUsageLog.createdAt)).limit(limit);
}
