// ─── حدّ معدّل بسيط داخل الذاكرة ──────────────────────────────────────────────
// يكفي لعملية واحدة على خادم واحد (وهو وضعنا الحالي مع pm2 fork).
// الغرض منه منع إغراق بريد المستخدمين برموز تحقق، لا الحماية من هجوم موزّع.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

/** يزيل النوافذ المنتهية حتى لا تنمو الخريطة بلا حد */
function sweep(now: number) {
  // forEach بدل for..of: إعدادات TS هنا لا تسمح بالتكرار المباشر على Map
  const expired: string[] = [];
  buckets.forEach((b, key) => { if (now >= b.resetAt) expired.push(key); });
  expired.forEach(key => buckets.delete(key));
}

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) sweep(now);

  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (b.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  b.count += 1;
  return { ok: true };
}

/**
 * عنوان العميل الحقيقي. التطبيق خلف nginx بدون `trust proxy`، فـ `req.ip`
 * يساوي 127.0.0.1 لكل الزوار — عديم الفائدة للتحديد. nginx يضيف العنوان
 * الحقيقي في نهاية X-Forwarded-For، فآخر عنصر هو الموثوق (ما يرسله العميل
 * نفسه يسبقه ويمكن تزويره).
 */
export function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : typeof xff === "string" ? xff : "";
  const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : (req.ip ?? "unknown");
}

/** للاختبارات فقط */
export function __resetRateLimits() {
  buckets.clear();
}
