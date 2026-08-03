/**
 * إضافة عمود `llm_usage_log.app` — من أنفق، لا كم أُنفق فقط.
 *
 * السجل يعرف الموديل والتكلفة ولا يعرف **من ناداه**. وسارة وشهد تتقاسمان مفتاح
 * OpenRouter نفسه، فما يعرضه المزوّد مجموعٌ لا يُفصل. وبلا هذا العمود يبقى
 * السؤال «مين بيستهلك إيه؟» بلا جواب في أي مكان.
 *
 * القيمة الافتراضية `sara`: كل ما سُجّل حتى اليوم كان من المنصة نفسها، فنسبته
 * إليها صحيحة لا تخمين.
 *
 * آمن ومتكرر: يفحص قبل كل خطوة، ولا يحذف ولا يعدّل صفاً قائماً غير هذا العمود.
 * التشغيل:  npx tsx scripts/apply-llm-usage-app.mts          (معاينة)
 *           npx tsx scripts/apply-llm-usage-app.mts --apply  (تنفيذ)
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const APPLY = process.argv.includes("--apply");

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

const [before] = (await run("SELECT COUNT(*) n FROM `llm_usage_log`")) as unknown as [{ n: number }[]];
console.log(`صفوف llm_usage_log قبل: ${Number(before[0].n)}`);

const [col] = (await run("SHOW COLUMNS FROM `llm_usage_log` LIKE 'app'")) as unknown as [unknown[]];
if (col.length) {
  console.log("• العمود app موجود مسبقاً — لا تغيير");
} else if (!APPLY) {
  console.log("سيُضاف: ALTER TABLE `llm_usage_log` ADD `app` varchar(40) NOT NULL DEFAULT 'sara'");
  console.log("       CREATE INDEX `llm_usage_app_idx` ON `llm_usage_log` (`app`, `createdAt`)");
  console.log("\n(معاينة فقط — أضف --apply)");
  process.exit(0);
} else {
  await run("ALTER TABLE `llm_usage_log` ADD `app` varchar(40) NOT NULL DEFAULT 'sara'");
  console.log("✓ أُضيف العمود app (الصفوف القائمة تُنسب إلى sara — وهي مصدرها فعلاً)");

  //التجميع يقع دائماً على (التطبيق، التاريخ)، وبلا فهرس يُمسح الجدول كلّه
  //كلما فُتحت اللوحة.
  const [idx] = (await run("SHOW INDEX FROM `llm_usage_log` WHERE Key_name = 'llm_usage_app_idx'")) as unknown as [unknown[]];
  if (!idx.length) {
    await run("CREATE INDEX `llm_usage_app_idx` ON `llm_usage_log` (`app`, `createdAt`)");
    console.log("✓ أُضيف الفهرس llm_usage_app_idx");
  }
}

const [after] = (await run("SELECT COUNT(*) n FROM `llm_usage_log`")) as unknown as [{ n: number }[]];
const [dist] = (await run("SELECT `app`, COUNT(*) n FROM `llm_usage_log` GROUP BY `app`")) as unknown as [{ app: string; n: number }[]];
console.log(`صفوف بعد: ${Number(after[0].n)}`);
for (const d of dist) { console.log(`  ${d.app}: ${Number(d.n)}`); }
if (Number(after[0].n) !== Number(before[0].n)) { console.error("✗ تغيّر عدد الصفوف — راجع"); process.exit(1); }
console.log("✓ تمّ");
process.exit(0);
