// ─── قراءة أسعار الباقات حسب سوق الزائر ──────────────────────────────────────
//
// السقوط الآمن هو القاعدة هنا: سوق بلا صف سعر يُعرض بسعر السعودية لا بلا سعر.
// صفحة أسعار فارغة تفقد الزائر، وسعر السوق الأصلي يُبقيه — والخطأ في الاتجاه
// هذا قابل للتصحيح، أما الزائر الذي غادر فلا يعود.

import { getDb } from "./db";
import { plans, planPrices } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_MARKET, MARKETS, isMarketCode, resolveMarket, type MarketCode } from "../shared/pricing";

export type ResolvedPrice = {
  planId: number;
  market: MarketCode;
  currency: string;
  price: number;
  vatRatePct: number;
  /** هل السعر من سوق الزائر فعلاً أم سقط للافتراضي؟ الواجهة تحتاج أن تعرف. */
  isFallback: boolean;
};

/**
 * السوق المستنتج من الطلب.
 *
 * لا خدمة GeoIP هنا: nginx لا يمرّر بلد الزائر، وإضافة نداء خارجي لكل زيارة
 * ثمنٌ في السرعة والاعتماد مقابل تخمين. الترتيب المعتمد: اختيار صريح ثم مفتاح
 * الجوال (كتبه العميل بنفسه فهو أوثق من موقعه) ثم رأس بلد إن وُجد يوماً.
 */
export function marketFromRequest(req: {
  headers: Record<string, unknown>;
  cookies?: Record<string, string>;
}, phone?: string | null): MarketCode {
  const header = (k: string) => {
    const v = req.headers[k];
    return typeof v === "string" ? v : Array.isArray(v) ? String(v[0]) : null;
  };
  return resolveMarket({
    explicit: req.cookies?.market ?? header("x-market"),
    phone,
    // يملؤه Cloudflare أو وحدة geoip إن فُعِّلت لاحقاً — غيابه اليوم لا يعطّل شيئاً
    ipCountry: header("cf-ipcountry") ?? header("x-country-code"),
  });
}

/** أسعار كل الباقات في سوق واحد، مع السقوط للافتراضي عند غياب الصف. */
export async function pricesForMarket(market: MarketCode): Promise<Map<number, ResolvedPrice>> {
  const out = new Map<number, ResolvedPrice>();
  const db = await getDb();
  if (!db) return out;

  const all = await db.select().from(planPrices).where(eq(planPrices.isActive, true));
  const base = await db.select().from(plans);

  for (const p of base) {
    const exact = all.find(r => r.planId === p.id && r.market === market);
    const fallback = all.find(r => r.planId === p.id && r.market === DEFAULT_MARKET);
    const row = exact ?? fallback;
    out.set(p.id, {
      planId: p.id,
      market: exact ? market : DEFAULT_MARKET,
      currency: row?.currency ?? p.currency ?? MARKETS[DEFAULT_MARKET].currency,
      // آخر سقوط: عمود السعر على الباقة نفسها، كي لا تخلو الصفحة أبداً
      price: Number(row?.price ?? p.price),
      vatRatePct: Number(row?.vatRatePct ?? 15),
      isFallback: !exact,
    });
  }
  return out;
}

/** سعر باقة بعينها — يُستعمل عند إنشاء الدفعة لا عند العرض فقط. */
export async function priceForPlan(planId: number, market: MarketCode): Promise<ResolvedPrice | undefined> {
  return (await pricesForMarket(market)).get(planId);
}

/**
 * السعر الذي يُحاسَب عليه اشتراك قائم.
 *
 * المثبَّت وقت الشراء يعلو على جدول اليوم: من اشترك بسعر لا يُفاجأ برفعه لأننا
 * غيّرنا التسعير، ولا بتغيّره لأنه فتح الموقع من بلد آخر.
 */
export function billingPriceFor(sub: {
  priceAtPurchase?: string | number | null;
  currencyAtPurchase?: string | null;
  marketAtPurchase?: string | null;
}, current: ResolvedPrice): { price: number; currency: string; market: MarketCode; frozen: boolean } {
  const frozenPrice = sub.priceAtPurchase == null ? null : Number(sub.priceAtPurchase);
  if (frozenPrice != null && Number.isFinite(frozenPrice) && frozenPrice > 0) {
    return {
      price: frozenPrice,
      currency: sub.currencyAtPurchase ?? current.currency,
      market: isMarketCode(sub.marketAtPurchase) ? sub.marketAtPurchase : current.market,
      frozen: true,
    };
  }
  return { price: current.price, currency: current.currency, market: current.market, frozen: false };
}

/** الأسواق المعروضة في مبدّل العملة: ما له صف سعر فعّال فقط. */
export async function activeMarkets(): Promise<MarketCode[]> {
  const db = await getDb();
  if (!db) return [DEFAULT_MARKET];
  const rows = await db.select({ market: planPrices.market })
    .from(planPrices).where(eq(planPrices.isActive, true));
  const set = new Set<MarketCode>([DEFAULT_MARKET]);
  for (const r of rows) if (isMarketCode(r.market)) set.add(r.market);
  return Array.from(set);
}

