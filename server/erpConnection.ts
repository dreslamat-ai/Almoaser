/**
 * اتصال ERPNext لكل مستخدم:
 * - يخزّن كل عميل رابط نظامه + مستخدمه + كلمة مروره (مشفرة AES-256-GCM)
 * - getErpConfigForUser: يرجع اتصال المستخدم إن وُجد، وإلا اتصال النظام الافتراضي (env)
 * - جلسات sid مخزنة في كاش لكل اتصال على حدة
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { erpnextConnections, users } from "../drizzle/schema";
import { resolveOrgOwnerId } from "./organizations";

// ─── تشفير كلمة المرور ────────────────────────────────────────────────────────
function getKey(): Buffer {
  const secret = process.env.JWT_SECRET ?? "fallback-secret";
  return crypto.createHash("sha256").update(`erp-conn:${secret}`).digest();
}

export function encryptPassword(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptPassword(encStr: string): string {
  const [ivB64, tagB64, dataB64] = encStr.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// ─── إعدادات الاتصال ─────────────────────────────────────────────────────────
export type ErpConfig = { url: string; username: string; password: string; source: "user" | "system" };

export async function getErpConfigForUser(userId: number): Promise<ErpConfig> {
  try {
    const db = await getDb();
    if (db) {
      // المستخدمون الفرعيون يستخدمون اتصال ERPNext الخاص بمالك منظمتهم
      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const effectiveUserId = userRows[0] ? await resolveOrgOwnerId(userRows[0]) : userId;
      const rows = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, effectiveUserId)).limit(1);
      const conn = rows[0];
      if (conn) {
        return {
          url: conn.url.replace(/\/+$/, ""),
          username: conn.username,
          password: decryptPassword(conn.passwordEnc),
          source: "user",
        };
      }
    }
  } catch (e) {
    console.error("[erpConnection] failed to load user connection, falling back to system:", e instanceof Error ? e.message : e);
  }
  return {
    url: (process.env.ERPNEXT_URL ?? "").replace(/\/+$/, ""),
    username: process.env.ERPNEXT_USERNAME ?? "",
    password: process.env.ERPNEXT_PASSWORD ?? "",
    source: "system",
  };
}

// ─── كاش الجلسات لكل اتصال ────────────────────────────────────────────────────
const sessionCache = new Map<string, { sid: string; expiry: number }>();

export async function getErpSession(config: ErpConfig): Promise<string> {
  const cacheKey = `${config.url}|${config.username}`;
  const cached = sessionCache.get(cacheKey);
  const now = Date.now();
  if (cached && now < cached.expiry) return cached.sid;

  if (!config.url || !config.username || !config.password) {
    throw new Error("بيانات اتصال ERPNext غير مكتملة — أضف الرابط واسم المستخدم وكلمة المرور من صفحة الإعدادات");
  }
  const res = await fetch(`${config.url}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr: config.username, pwd: config.password }),
  });
  if (!res.ok) throw new Error(`فشل تسجيل الدخول إلى ERPNext (${res.status}) — تحقق من بيانات الاتصال في الإعدادات`);
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = cookie.match(/sid=([^;]+)/);
  if (!m || m[1] === "Guest") throw new Error("بيانات اعتماد ERPNext غير صحيحة — تحقق من اسم المستخدم وكلمة المرور");
  sessionCache.set(cacheKey, { sid: m[1], expiry: now + 6 * 60 * 60 * 1000 });
  return m[1];
}

export function invalidateErpSession(config: ErpConfig): void {
  sessionCache.delete(`${config.url}|${config.username}`);
}

/** اختبار اتصال مباشر — يرجع اسم المستخدم المسجل عند النجاح */
export async function testErpConnection(url: string, username: string, password: string): Promise<{ ok: boolean; loggedInAs?: string; error?: string }> {
  try {
    const cleanUrl = url.replace(/\/+$/, "");
    const res = await fetch(`${cleanUrl}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: username, pwd: password }),
    });
    if (!res.ok) return { ok: false, error: `فشل تسجيل الدخول (${res.status}) — تحقق من الرابط وبيانات الاعتماد` };
    const cookie = res.headers.get("set-cookie") ?? "";
    const m = cookie.match(/sid=([^;]+)/);
    if (!m || m[1] === "Guest") return { ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة" };
    const body = (await res.json().catch(() => ({}))) as { full_name?: string };
    return { ok: true, loggedInAs: body.full_name ?? username };
  } catch (e) {
    return { ok: false, error: `تعذّر الوصول إلى الخادم: ${e instanceof Error ? e.message : "خطأ غير معروف"}` };
  }
}

