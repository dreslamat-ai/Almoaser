// تحقّق حيّ من مسار التحصيل على نظام عميل حقيقي — **بلا كتابة أي سند**.
// يقرأ طرق الدفع والفواتير وعدّ فواتير كل عميل (وهو ما تعرضه صفحة العملاء)،
// ثم يجرّب عميلاً وهمياً ليثبت أن الإجراء يصل executeTool ويُرفض قبل أي POST.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users, erpnextConnections } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import { resolveOrgOwnerId } from "../server/organizations";

const db = await getDb();
if (!db) throw new Error("لا اتصال بقاعدة البيانات");

const conns = await db.select().from(erpnextConnections).limit(5);
console.log("اتصالات ERP:", conns.map(c => `${c.userId}:${c.provider}`).join(" · ") || "(لا شيء)");

for (const c of conns) {
  const u = (await db.select().from(users).where(eq(users.id, c.userId)).limit(1))[0];
  if (!u) continue;
  const caller = appRouter.createCaller({
    req: { headers: {} } as never,
    res: undefined as never,
    user: u,
    effectiveUserId: await resolveOrgOwnerId(u),
  } as never);

  console.log(`\n── مستخدم ${u.id} (${u.email ?? "—"})`);
  try {
    const modes = await caller.erpnext.getPaymentModes();
    const inv = await caller.erpnext.getSalesInvoices({ limit: 200 });
    const cust = await caller.erpnext.getCustomers({ limit: 100 });
    const counts = await caller.erpnext.getInvoiceCountsByCustomer();
    const rows = (inv.data ?? []) as Array<{ name: string; customer: string; outstanding_amount: number; status: string }>;
    const due = rows.filter(r => (r.outstanding_amount ?? 0) > 0 && r.status !== "Draft" && r.status !== "Cancelled");
    console.log("  طرق الدفع:", modes.modes.length ? modes.modes.join("، ") : "(غير معرّفة — سيُستخدم الحساب الافتراضي)");
    console.log(`  فواتير: ${rows.length} — قابلة للتحصيل: ${due.length} — عملاء: ${((cust.data ?? []) as unknown[]).length}`);

    // العدّ من الخادم (بلا صفحات) هو ما تعرضه صفحة العملاء
    const entries = Object.entries(counts.counts);
    console.log("  عدّ الخادم:", counts.error ? `تعذّر — ${counts.error.slice(0, 60)}` :
      `${entries.length} عميلاً · ` + entries.sort((a, b) => b[1].count - a[1].count).slice(0, 3)
        .map(([k, v]) => `${k}=${v.count}`).join(" · ") || "(لا شيء)");
    // ويُقارَن بعدّ الصفحة المقتطعة: الفرق هو ما كان يُعرض خطأً
    const per = new Map<string, number>();
    for (const r of rows) per.set(r.customer, (per.get(r.customer) ?? 0) + 1);
    const totalServer = entries.reduce((a, [, v]) => a + v.count, 0);
    if (totalServer !== rows.length) console.log(`  ⚠ الصفحة تُظهر ${rows.length} من ${totalServer} — العدّ منها كان سيكذب`);

    // ترشيح العميل على الخادم: فواتيره وحدها
    if (entries.length) {
      const who = entries[0][0];
      const only = await caller.erpnext.getSalesInvoices({ limit: 200, customer: who });
      const n = ((only.data ?? []) as unknown[]).length;
      console.log(`  ترشيح «${who}» على الخادم: ${n} — والعدّ يقول ${entries[0][1].count}`,
        n === entries[0][1].count ? "✓ متطابقان" : "✗ مختلفان");
    }
    if (due[0]) console.log(`  مرشّح للتحصيل: ${due[0].name} / ${due[0].customer} / ${due[0].outstanding_amount}`);
  } catch (e) {
    console.log("  ✗ تعذّرت القراءة:", (e as Error).message.slice(0, 120));
    continue;
  }

  try {
    await caller.erpnext.collectInvoicePayment({
      invoiceName: "INV-فحص-غير-موجودة",
      customer: "عميل-وهمي-للفحص-لا-يوجد-إطلاقاً",
      amount: 1,
    });
    console.log("  ✗ لم يُرفض العميل الوهمي — راجع مسار الخطأ");
  } catch (e) {
    console.log("  ✓ رُفض العميل الوهمي:", (e as Error).message.slice(0, 100));
  }
}
process.exit(0);
