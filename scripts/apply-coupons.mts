/**
 * إنشاء جدولَي الكوبونات، وإضافة عمودَي الخصم على المدفوعات.
 *
 * يدوياً لا عبر drizzle-kit — راجع scripts/apply-vat-column.mts للسبب.
 * إنشاء جداول جديدة وإضافة أعمدة nullable لا يمسّ أي بيانات قائمة.
 *
 * التشغيل:  npx tsx scripts/apply-coupons.mts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال بقاعدة البيانات"); process.exit(1); }
const run = (q: string) => db.execute(sql.raw(q));
const has = async (t: string) => ((await run(`SHOW TABLES LIKE '${t}'`)) as unknown as [unknown[]])[0].length > 0;
const hasCol = async (t: string, c: string) =>
  ((await run(`SHOW COLUMNS FROM \`${t}\` LIKE '${c}'`)) as unknown as [unknown[]])[0].length > 0;

const before: Record<string, number> = {};
for (const t of ["users", "payments", "subscriptions"]) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  before[t] = Number(r[0].n);
}
console.log("عدد الصفوف قبل:", before);

if (await has("coupons")) console.log("• جدول coupons موجود");
else {
  await run(`
    CREATE TABLE \`coupons\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`code\` varchar(40) NOT NULL,
      \`description\` varchar(255),
      \`type\` enum('percent','fixed') NOT NULL,
      \`value\` decimal(10,2) NOT NULL,
      \`scope\` enum('subscription','topup','both') NOT NULL DEFAULT 'both',
      \`minAmountSar\` decimal(10,2),
      \`maxUses\` int,
      \`usedCount\` int NOT NULL DEFAULT 0,
      \`maxUsesPerUser\` int DEFAULT 1,
      \`validFrom\` timestamp NULL,
      \`validUntil\` timestamp NULL,
      \`isActive\` boolean NOT NULL DEFAULT true,
      \`createdBy\` int,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`coupons_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`coupons_code_unique\` UNIQUE(\`code\`)
    )`);
  console.log("✓ أُنشئ جدول coupons");
}

if (await has("coupon_redemptions")) console.log("• جدول coupon_redemptions موجود");
else {
  await run(`
    CREATE TABLE \`coupon_redemptions\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`couponId\` int NOT NULL,
      \`userId\` int NOT NULL,
      \`paymentId\` int,
      \`discountSar\` decimal(10,2) NOT NULL,
      \`createdAt\` timestamp NOT NULL DEFAULT (now()),
      CONSTRAINT \`coupon_redemptions_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`cr_coupon_fk\` FOREIGN KEY (\`couponId\`) REFERENCES \`coupons\`(\`id\`),
      CONSTRAINT \`cr_user_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`)
    )`);
  console.log("✓ أُنشئ جدول coupon_redemptions");
}

// المدفوعات تحتاج أثر الخصم: بلا ذلك لا يُعرف لماذا حُصّل مبلغ أقل من سعر الباقة
for (const [col, ddl] of [
  ["couponId", "ADD `couponId` int"],
  ["discountAmount", "ADD `discountAmount` decimal(10,2)"],
] as const) {
  if (await hasCol("payments", col)) console.log(`• payments.${col} موجود`);
  else { await run(`ALTER TABLE \`payments\` ${ddl}`); console.log(`✓ أُضيف payments.${col}`); }
}

let ok = await has("coupons") && await has("coupon_redemptions")
  && await hasCol("payments", "couponId") && await hasCol("payments", "discountAmount");
for (const [t, n] of Object.entries(before)) {
  const [r] = (await run(`SELECT COUNT(*) n FROM \`${t}\``)) as unknown as [{ n: number }[]];
  if (Number(r[0].n) !== n) { console.error(`✗ تغيّر عدد صفوف ${t}`); ok = false; }
}
console.log(ok ? "\n✓ تمّ — لم تُمسّ أي بيانات" : "\n✗ فشل التحقق");
process.exit(ok ? 0 : 1);
