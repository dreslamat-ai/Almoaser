// ─── فحص صحّة اتصالات العملاء بأنظمتهم ───────────────────────────────────────
//
// الاعتماد يقع مرّة عند الحفظ ولا يُعاد. وكلمة السرّ تتغيّر على الطرف الآخر،
// أو يُعطَّل الحساب، بلا أن يصلنا خبر — فيبقى العميل يحاول ويفشل ونحن لا نعلم.
//
// **قراءة فقط:** محاولة تسجيل دخول واحدة لكل اتصال. لا يُكتب شيء ولا تُعدَّل
// بيانات أحد، ولا تُطبع كلمة سرّ ولا جزء منها في أي سجل.
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { decryptPassword } from "./erpConnection";

export type BrokenConnection = { id: number; userId: number; email: string; url: string; reason: string };

const LOGIN_TIMEOUT_MS = 15_000;

export async function checkErpConnections(): Promise<{ ok: number; broken: BrokenConnection[] }> {
  const db = await getDb();
  if (!db) return { ok: 0, broken: [] };

  const [rows] = (await db.execute(sql.raw(
    `SELECT c.id, c.userId, c.url, c.username, c.passwordEnc, c.provider, u.email
     FROM erpnext_connections c JOIN users u ON u.id = c.userId`,
  ))) as unknown as [Array<{ id: number; userId: number; url: string; username: string; passwordEnc: string; provider: string; email: string }>];

  let ok = 0;
  const broken: BrokenConnection[] = [];

  for (const r of rows) {
    //Odoo تُفحص بمسار آخر؛ فحصها بمسار ERPNext يعطي 404 يُقرأ عطلاً وهو ليس كذلك
    if (r.provider && r.provider !== "erpnext") { ok++; continue; }

    let password = "";
    try {
      password = decryptPassword(r.passwordEnc);
    } catch {
      broken.push({ id: r.id, userId: r.userId, email: r.email, url: r.url, reason: "تعذّر فكّ تشفير كلمة السرّ المحفوظة" });
      continue;
    }

    try {
      const res = await fetch(`${r.url}/api/method/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usr: r.username, pwd: password }),
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      });
      if (res.ok) { ok++; continue; }
      broken.push({
        id: r.id, userId: r.userId, email: r.email, url: r.url,
        reason: res.status === 401
          ? "بيانات الدخول مرفوضة (401) — كلمة السرّ تغيّرت أو الحساب معطَّل"
          : `الخادم ردّ ${res.status}`,
      });
    } catch (e) {
      broken.push({
        id: r.id, userId: r.userId, email: r.email, url: r.url,
        reason: `تعذّر الوصول: ${e instanceof Error ? e.message.slice(0, 60) : "خطأ شبكة"}`,
      });
    }
  }

  return { ok, broken };
}

// ─── حالة ربط مستخدم واحد ────────────────────────────────────────────────────

export type ConnectionStatus = {
  configured: boolean;
  ok: boolean;
  url?: string;
  reason?: string;
  checkedAt: string;
};

/** الناتج يعيش دقيقتين: الشاشات تسأل كثيراً ونظام العميل لا يحتمل نداءً لكل سؤال */
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map<number, { at: number; value: ConnectionStatus }>();

export async function getConnectionStatus(userId: number): Promise<ConnectionStatus> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const db = await getDb();
  if (!db) return { configured: false, ok: false, reason: "قاعدة البيانات غير متاحة", checkedAt: new Date().toISOString() };

  const [rows] = (await db.execute(sql.raw(
    `SELECT url, username, passwordEnc, provider FROM erpnext_connections WHERE userId = ${Number(userId)} LIMIT 1`,
  ))) as unknown as [Array<{ url: string; username: string; passwordEnc: string; provider: string }>];

  const r = rows[0];
  const now = new Date().toISOString();
  if (!r) {
    const value: ConnectionStatus = { configured: false, ok: false, reason: "لم تُضبط بيانات الربط بعد", checkedAt: now };
    cache.set(userId, { at: Date.now(), value });
    return value;
  }

  //Odoo تُفحص بمسار آخر؛ فحصها بمسار ERPNext يعطي 404 يُقرأ عطلاً وهو ليس كذلك
  if (r.provider && r.provider !== "erpnext") {
    const value: ConnectionStatus = { configured: true, ok: true, url: r.url, checkedAt: now };
    cache.set(userId, { at: Date.now(), value });
    return value;
  }

  let value: ConnectionStatus;
  try {
    const password = decryptPassword(r.passwordEnc);
    const res = await fetch(`${r.url}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: r.username, pwd: password }),
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
    value = res.ok
      ? { configured: true, ok: true, url: r.url, checkedAt: now }
      : {
          configured: true, ok: false, url: r.url, checkedAt: now,
          reason: res.status === 401
            ? "بيانات الدخول لم تعد صحيحة — غالباً تغيّرت كلمة السرّ على نظامك"
            : `نظامك ردّ ${res.status}`,
        };
  } catch (e) {
    value = {
      configured: true, ok: false, url: r.url, checkedAt: now,
      reason: `تعذّر الوصول إلى نظامك: ${e instanceof Error ? e.message.slice(0, 60) : "خطأ شبكة"}`,
    };
  }

  cache.set(userId, { at: Date.now(), value });
  return value;
}
