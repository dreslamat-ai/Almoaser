/**
 * إنشاء جدول agent_reports.
 *
 * يدوياً لا عبر drizzle-kit — راجع scripts/apply-vat-column.mts للسبب.
 * إنشاء جدول جديد لا يمسّ أي بيانات قائمة.
 *
 * التشغيل:  npx tsx scripts/apply-agent-reports.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));

const before: Record<string, number> = {};
for (const t of ["users", "agent_conversations", "agent_messages"]) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  before[t] = Number(r[0].n);
}
console.log("عدد الصفوف قبل:", before);

const [exists] = (await run("SHOW TABLES LIKE 'agent_reports'")) as unknown as [unknown[]];
if (exists.length) {
  console.log("• الجدول موجود مسبقاً — لا تغيير");
} else {
  await run(`
    CREATE TABLE \`agent_reports\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`conversationId\` int,
      \`kind\` enum('system_assessment','handover_terms','contract_review','policies','workflow_design','other') NOT NULL DEFAULT 'other',
      \`title\` varchar(255) NOT NULL,
      \`content\` text NOT NULL,
      \`status\` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
      \`reviewedAt\` timestamp NULL,
      \`reviewNote\` text,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`agent_reports_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`agent_reports_userId_users_id_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`)
    )`);
  console.log("✓ أُنشئ الجدول agent_reports");
}

let ok = true;
const [check] = (await run("SHOW TABLES LIKE 'agent_reports'")) as unknown as [unknown[]];
if (!check.length) { console.error("✗ الجدول غير موجود بعد التنفيذ"); ok = false; }
for (const [t, n] of Object.entries(before)) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  if (Number(r[0].n) !== n) { console.error(`✗ تغيّر عدد صفوف ${t}`); ok = false; }
}
console.log(ok ? "\n✓ تمّ — لم تُمسّ أي بيانات" : "\n✗ فشل التحقق");
process.exit(ok ? 0 : 1);
