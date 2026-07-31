/**
 * إضافة عمود payments.vatAmount وإصلاح سجل ترحيلات drizzle.
 *
 * لماذا يدوياً: سجل __drizzle_migrations لا يسجّل الترحيل 0014 رغم أن تغييراته
 * مطبَّقة فعلاً في القاعدة (جدول phone_otps وعمودا users.phone موجودة). هذا
 * التنافر يجعل:
 *   - drizzle-kit migrate يحاول إعادة تطبيق 0014 فيعلّق،
 *   - drizzle-kit push يرى فرقاً وهمياً ويقترح حلّاً مدمّراً — لوحظ فعلاً وهو
 *     يحاول تنفيذ `truncate table agent_conversations`، أي مسح محادثات العملاء.
 *
 * لذلك نطبّق تعديلاً واحداً محدداً، ونسجّل الترحيلين، فتعود الأداة لحالة سليمة.
 *
 * آمن ومتكرر: يفحص قبل كل خطوة ولا يكرر شيئاً، ولا يحذف ولا يعدّل أي بيانات.
 * التشغيل:  npx tsx scripts/apply-vat-column.mts
 */
import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const MIGRATIONS = ["drizzle/0014_swift_raza.sql", "drizzle/0015_fancy_sharon_ventura.sql"];

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

// ─── 1) لقطة قبل التعديل، للتحقق بعده ────────────────────────────────────────
const counted: Record<string, number> = {};
for (const t of ["payments", "agent_conversations", "agent_messages", "credit_transactions", "users"]) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  counted[t] = Number(r[0].n);
}
console.log("عدد الصفوف قبل:", counted);

// ─── 2) العمود ───────────────────────────────────────────────────────────────
const [col] = (await run("SHOW COLUMNS FROM `payments` LIKE 'vatAmount'")) as unknown as [unknown[]];
if (col.length) {
  console.log("• العمود vatAmount موجود مسبقاً — لا تغيير");
} else {
  await run("ALTER TABLE `payments` ADD `vatAmount` decimal(10,2)");
  console.log("✓ أُضيف العمود vatAmount (nullable — الصفوف القديمة تبقى null)");
}

// ─── 3) سجل الترحيلات ────────────────────────────────────────────────────────
const [journal] = (await run("SELECT hash FROM `__drizzle_migrations`")) as unknown as [{ hash: string }[]];
const recorded = new Set(journal.map(r => r.hash));
for (const file of MIGRATIONS) {
  const hash = createHash("sha256").update(readFileSync(file, "utf8")).digest("hex");
  if (recorded.has(hash)) { console.log("• مسجَّل مسبقاً:", file); continue; }
  await run(`INSERT INTO \`__drizzle_migrations\` (hash, created_at) VALUES ('${hash}', ${Date.now()})`);
  console.log("✓ سُجّل:", file);
}

// ─── 4) التحقق: العمود موجود ولم تُمسّ أي بيانات ─────────────────────────────
const [check] = (await run("SHOW COLUMNS FROM `payments` LIKE 'vatAmount'")) as unknown as [unknown[]];
let ok = check.length > 0;
for (const [t, before] of Object.entries(counted)) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  const after = Number(r[0].n);
  if (after !== before) { console.error(`✗ تغيّر عدد صفوف ${t}: ${before} ← ${after}`); ok = false; }
}
console.log(ok ? "\n✓ تمّ. العمود جاهز وكل الصفوف كما هي — يمكن الآن npm run deploy" : "\n✗ فشل التحقق");
process.exit(ok ? 0 : 1);
