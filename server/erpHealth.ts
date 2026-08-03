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
