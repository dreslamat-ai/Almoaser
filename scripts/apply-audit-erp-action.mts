/**
 * إضافة قيمة `set_user_erp_connection` إلى enum سجل التدقيق.
 *
 * الإدارة صارت تستطيع تعديل ربط عميل بنظامه — أي كتابة كلمة سرّ في حساب
 * عميل. فعلٌ كهذا يجب أن يبقى له أثر، وسجل التدقيق عمودُه enum لا يقبل قيمة
 * لم تُعرَّف.
 *
 * غير مدمّر: توسيع enum لا يمسّ صفاً قائماً. آمن ومتكرر.
 *   npx tsx scripts/apply-audit-erp-action.mts          معاينة
 *   npx tsx scripts/apply-audit-erp-action.mts --apply  تنفيذ
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const APPLY = process.argv.includes("--apply");
const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

const [before] = (await run("SELECT COUNT(*) n FROM `admin_action_log`")) as unknown as [{ n: number }[]];
const [col] = (await run("SHOW COLUMNS FROM `admin_action_log` LIKE 'action'")) as unknown as [{ Type: string }[]];
const type = col[0]?.Type ?? "";
console.log(`صفوف السجل: ${Number(before[0].n)}`);
console.log(`النوع الحالي: ${type}`);

if (type.includes("set_user_erp_connection")) {
  console.log("• القيمة موجودة مسبقاً — لا تغيير");
  process.exit(0);
}

const next = type.replace(/^enum\((.*)\)$/i, (_m, inner: string) => `enum(${inner},'set_user_erp_connection')`);
if (next === type) { console.error("✗ تعذّر اشتقاق النوع الجديد"); process.exit(1); }

if (!APPLY) { console.log(`سيُنفَّذ: ALTER TABLE \`admin_action_log\` MODIFY \`action\` ${next} NOT NULL`); console.log("\n(معاينة فقط — أضف --apply)"); process.exit(0); }

await run(`ALTER TABLE \`admin_action_log\` MODIFY \`action\` ${next} NOT NULL`);
const [after] = (await run("SELECT COUNT(*) n FROM `admin_action_log`")) as unknown as [{ n: number }[]];
console.log(`✓ وُسّع enum — صفوف بعد: ${Number(after[0].n)}`);
if (Number(after[0].n) !== Number(before[0].n)) { console.error("✗ تغيّر عدد الصفوف"); process.exit(1); }
process.exit(0);
