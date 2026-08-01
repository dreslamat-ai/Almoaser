/**
 * إضافة عمود plans.mode وتسجيل الترحيل.
 *
 * يدوياً وليس عبر drizzle-kit: أدواته على هذه القاعدة غير موثوقة — راجع
 * scripts/apply-vat-column.mts، حيث حاول `push` تنفيذ truncate على جدول
 * المحادثات. إضافة عمود بقيمة افتراضية لا تلمس أي بيانات قائمة.
 *
 * آمن ومتكرر: يفحص قبل كل خطوة، ويتحقق من ثبات عدد الصفوف بعدها.
 * التشغيل:  npx tsx scripts/apply-plan-mode.mts
 */
import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

const before: Record<string, number> = {};
for (const t of ["plans", "subscriptions", "payments", "users"]) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  before[t] = Number(r[0].n);
}
console.log("عدد الصفوف قبل:", before);

const [col] = (await run("SHOW COLUMNS FROM `plans` LIKE 'mode'")) as unknown as [unknown[]];
if (col.length) {
  console.log("• العمود mode موجود مسبقاً — لا تغيير");
} else {
  await run("ALTER TABLE `plans` ADD `mode` enum('accounting','expert') NOT NULL DEFAULT 'accounting'");
  console.log("✓ أُضيف العمود mode (الباقات القائمة تبقى accounting)");
}

// تسجيل أي ملف ترحيل ولّده drizzle لهذا التغيير، حتى لا يحاول تطبيقه لاحقاً
const [journal] = (await run("SELECT hash FROM `__drizzle_migrations`")) as unknown as [{ hash: string }[]];
const recorded = new Set(journal.map(r => r.hash));
for (const f of process.argv.slice(2)) {
  if (!existsSync(f)) { console.log("• غير موجود، تخطٍّ:", f); continue; }
  const hash = createHash("sha256").update(readFileSync(f, "utf8")).digest("hex");
  if (recorded.has(hash)) { console.log("• مسجَّل مسبقاً:", f); continue; }
  await run(`INSERT INTO \`__drizzle_migrations\` (hash, created_at) VALUES ('${hash}', ${Date.now()})`);
  console.log("✓ سُجّل:", f);
}

let ok = true;
const [check] = (await run("SHOW COLUMNS FROM `plans` LIKE 'mode'")) as unknown as [unknown[]];
if (!check.length) { console.error("✗ العمود غير موجود بعد التنفيذ"); ok = false; }
for (const [t, n] of Object.entries(before)) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  if (Number(r[0].n) !== n) { console.error(`✗ تغيّر عدد صفوف ${t}: ${n} ← ${r[0].n}`); ok = false; }
}
console.log(ok ? "\n✓ تمّ — كل الصفوف كما هي" : "\n✗ فشل التحقق");
process.exit(ok ? 0 : 1);
