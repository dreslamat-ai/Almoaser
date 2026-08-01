/**
 * توسيع enum العمود admin_action_log.action بقيمة view_customer_conversation.
 *
 * يدوياً لا عبر drizzle-kit — راجع scripts/apply-vat-column.mts للسبب (حاول
 * `push` تنفيذ truncate على جدول المحادثات). توسيع enum بقيمة جديدة لا يمسّ أي
 * صف قائم: القيم السابقة تبقى صالحة كما هي.
 *
 * التشغيل:  npx tsx scripts/apply-audit-view-action.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const VALUES = [
  "activate_subscription", "set_subscription_status", "grant_credits",
  "extend_days", "set_user_role", "set_user_active",
  "view_customer_conversation",
];

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

const [beforeRows] = (await run("SELECT COUNT(*) n FROM `admin_action_log`")) as unknown as [{ n: number }[]];
const before = Number(beforeRows[0].n);
console.log("صفوف سجل التدقيق قبل:", before);

const [col] = (await run("SHOW COLUMNS FROM `admin_action_log` LIKE 'action'")) as unknown as [{ Type: string }[]];
const current = col[0]?.Type ?? "";
if (current.includes("view_customer_conversation")) {
  console.log("• القيمة موجودة مسبقاً — لا تغيير");
} else {
  const def = VALUES.map(v => `'${v}'`).join(",");
  await run(`ALTER TABLE \`admin_action_log\` MODIFY \`action\` enum(${def}) NOT NULL`);
  console.log("✓ وُسِّع الـenum");
}

const [after] = (await run("SHOW COLUMNS FROM `admin_action_log` LIKE 'action'")) as unknown as [{ Type: string }[]];
const [afterRows] = (await run("SELECT COUNT(*) n FROM `admin_action_log`")) as unknown as [{ n: number }[]];
const ok = (after[0]?.Type ?? "").includes("view_customer_conversation") && Number(afterRows[0].n) === before;
console.log("النوع الآن:", after[0]?.Type);
console.log(ok ? "\n✓ تمّ — الصفوف كما هي" : "\n✗ فشل التحقق");
process.exit(ok ? 0 : 1);
