/**
 * إنشاء فواتير الخدمة للمدفوعات المحصَّلة سابقاً.
 *
 * الجدول كان يُقرأ ولا يُكتب فيه قط، فكل من دفع منذ إطلاق المنصة لا يجد
 * فاتورته. تُستدرَك هنا من `payments` — وهي المصدر الموثوق: الفاتورة سجلٌّ
 * لما وقع، والذي وقع مسجَّلٌ هناك.
 *
 * آمن ومتكرر: لا تُنشأ فاتورة لدفعة لها فاتورة.
 *   npx tsx scripts/backfill-service-invoices.mts          معاينة
 *   npx tsx scripts/backfill-service-invoices.mts --apply  تنفيذ
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";
import { createServiceInvoice } from "../server/serviceInvoice";

const APPLY = process.argv.includes("--apply");
const db = await getDb();
if (!db) { console.error("✗ تعذّر الاتصال"); process.exit(1); }

const [paid] = (await db.execute(sql.raw(
  `SELECT p.id, p.userId, p.amount, p.purpose, p.credits, p.billing, p.paidAt, p.createdAt, u.email
   FROM payments p JOIN users u ON u.id = p.userId
   WHERE p.status = 'paid' ORDER BY p.id`,
))) as unknown as [Array<Record<string, unknown>>];

const [existing] = (await db.execute(sql.raw("SELECT COUNT(*) n FROM service_invoices"))) as unknown as [{ n: number }[]];
console.log(`مدفوعات محصَّلة: ${paid.length} · فواتير قائمة: ${Number(existing[0].n)}\n`);

//المطابقة بالمبلغ والمستخدم: لا عمود يربط الفاتورة بالدفعة، والتكرار أسوأ
//من النقص — فاتورتان لدفعة واحدة تُقرآن دفعتين.
const [rows] = (await db.execute(sql.raw("SELECT userId, amount, description FROM service_invoices"))) as unknown as [Array<{ userId: number; amount: string; description: string }>];
const seen = new Set(rows.map(r => `${r.userId}|${Number(r.amount).toFixed(2)}|${r.description}`));

let made = 0;
for (const p of paid) {
  const purpose = (p.purpose ?? "subscription") as "subscription" | "topup" | "extension";
  const amount = Number(p.amount);
  const desc = purpose === "topup" ? `شحن رصيد — ${Number(p.credits ?? 0)} نقطة`
    : purpose === "extension" ? "تمديد اشتراك"
    : `اشتراك ${p.billing === "yearly" ? "سنوي" : "شهري"}`;
  const key = `${p.userId}|${amount.toFixed(2)}|${desc}`;
  if (seen.has(key)) { console.log(`  = دفعة #${p.id} لها فاتورة`); continue; }

  console.log(`  ${APPLY ? "+" : "سيُنشأ"} #${p.id} · ${p.email} · ${amount.toFixed(2)} ريال · ${desc}`);
  if (APPLY) {
    await createServiceInvoice({
      userId: Number(p.userId), amount, purpose,
      credits: p.credits == null ? null : Number(p.credits),
      billing: (p.billing as string) ?? null,
      //`execute` الخام يعيد التواريخ نصّاً لا كائن Date، وdrizzle ينادي
      //toISOString عليها — فتُحوَّل هنا صراحةً.
      paidAt: new Date((p.paidAt ?? p.createdAt ?? Date.now()) as string | number | Date),
    });
    seen.add(key);
  }
  made++;
}

console.log(`\n${APPLY ? "أُنشئت" : "ستُنشأ"} ${made} فاتورة`);
if (!APPLY) console.log("(معاينة فقط — أضف --apply)");
process.exit(0);
