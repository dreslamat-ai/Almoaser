// دمج العملاء المحتملين المكرّرين الموجودين قبل تفعيل المطابقة.
//
// يعمل بالمعاينة افتراضياً ولا يكتب شيئاً. للتنفيذ: --apply
//
// قاعدة الدمج هي نفسها المستعملة وقت الإدخال — الاسم بعد التوحيد، بشرط ألّا
// تتعارض المدينة ولا النشاط. ويُبقي **الأقدم** لأنه أصل الحديث، ويملأ فراغاته
// من الأحدث دون أن يطمس قيمة قائمة.
import "dotenv/config";
import { getDb } from "../server/db";
import { salesLeads } from "../drizzle/schema";
import { normalizeArabicName } from "../server/salesLeads";
import { eq } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const attr = (v: string | null) => (v?.trim() ? normalizeArabicName(v).replace(/^ال/, "") : "");
const clash = (a: string | null, b: string | null) => attr(a) !== "" && attr(b) !== "" && attr(a) !== attr(b);

const db = await getDb();
if (!db) { console.error("قاعدة البيانات غير متاحة"); process.exit(1); }

const rows = await db.select().from(salesLeads).orderBy(salesLeads.id);
console.log(`الصفوف: ${rows.length}\n`);

type Row = typeof rows[number];
const groups: Row[][] = [];
for (const r of rows) {
  const g = groups.find(g =>
    normalizeArabicName(g[0].name) === normalizeArabicName(r.name)
    && !g.some(x => clash(x.city, r.city) || clash(x.activity, r.activity)),
  );
  if (g) g.push(r); else groups.push([r]);
}

const dupes = groups.filter(g => g.length > 1);
if (!dupes.length) { console.log("لا تكرار."); process.exit(0); }

let merged = 0, removed = 0;
for (const g of dupes) {
  const keep = g[0];
  const rest = g.slice(1);
  // الأحدث يملأ فراغ الأقدم فقط — لا يستبدل قيمة موجودة
  const fill: Record<string, unknown> = {};
  for (const f of ["phone", "city", "activity", "employees", "interestedPlanId", "notes"] as const) {
    if (keep[f] == null || keep[f] === "") {
      const donor = rest.find(r => r[f] != null && r[f] !== "");
      if (donor) fill[f] = donor[f];
    }
  }
  // حالة متقدّمة تُحفظ: من تواصلنا معه أو تحوّل لا يعود "جديداً" بالدمج
  const best = g.find(r => r.status === "converted") ?? g.find(r => r.status === "contacted");
  if (best && best.status !== keep.status) fill.status = best.status;

  console.log(`«${keep.name}» → يُبقى #${keep.id}، يُحذف ${rest.map(r => "#" + r.id).join(" ")}`);
  if (Object.keys(fill).length) console.log(`   يُستكمل: ${JSON.stringify(fill)}`);

  if (APPLY) {
    // الحذف قبل الاستكمال: الجوال عمود فريد، ونقله إلى الصف الباقي قبل حذف
    // حامله الحالي يصطدم بالقيد. القيم مقروءة في الذاكرة قبل الحذف فلا تُفقد.
    for (const r of rest) await db.delete(salesLeads).where(eq(salesLeads.id, r.id));
    if (Object.keys(fill).length) await db.update(salesLeads).set(fill as never).where(eq(salesLeads.id, keep.id));
  }
  merged++; removed += rest.length;
}

console.log(`\n${APPLY ? "نُفِّذ" : "معاينة"}: ${merged} مجموعة، ${removed} صفاً يُحذف.`);
if (!APPLY) console.log("للتنفيذ: npx tsx scripts/merge-duplicate-leads.mts --apply");
process.exit(0);
