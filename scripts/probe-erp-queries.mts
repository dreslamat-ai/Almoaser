// استطلاع قراءةٍ فقط: هل يقبل ERPNext تجميع عدد الفواتير لكل عميل في نداء
// واحد، وهل يقبل ترشيح سندات القبض بحقلٍ في جدولها الفرعي؟
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users, erpnextConnections } from "../drizzle/schema";
import { runWithErpConfig, erpGET } from "../server/agent/erpClient";

const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const conns = await db.select().from(erpnextConnections).limit(6);

for (const c of conns) {
  const u = (await db.select().from(users).where(eq(users.id, c.userId)).limit(1))[0];
  if (!u) continue;
  console.log(`\n── ${u.id} (${u.email})`);
  await runWithErpConfig(u.id, async () => {
    // ١) تجميع: عدد الفواتير والمستحقّ لكل عميل في نداء واحد
    try {
      const f = encodeURIComponent(JSON.stringify(["customer", "outstanding_amount"]));
      const r = await erpGET(`/api/resource/Sales%20Invoice?fields=${f}&limit_page_length=0`) as { data: Array<{ customer: string }> };
      const m = new Map<string, number>();
      for (const x of r.data ?? []) m.set(x.customer, (m.get(x.customer) ?? 0) + 1);
      console.log(`  كل الفواتير بحقلين: ${r.data?.length ?? 0} صفّاً · ${m.size} عميلاً ·`,
        [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k}=${v}`).join(" · "));
    } catch (e) {
      console.log("  ✗ التجميع:", (e as Error).message.slice(0, 120));
    }
    // ٢) ترشيح سند قبض بحقلٍ في الجدول الفرعي
    try {
      const inv = await erpGET(`/api/resource/Sales%20Invoice?limit=1&fields=%5B%22name%22%5D&order_by=creation%20desc`) as { data: Array<{ name: string }> };
      const name = inv.data?.[0]?.name;
      if (!name) { console.log("  (لا فواتير للاختبار)"); return; }
      const flt = encodeURIComponent(JSON.stringify([["Payment Entry Reference", "reference_name", "=", name], ["docstatus", "=", 0]]));
      const r = await erpGET(`/api/resource/Payment%20Entry?filters=${flt}&fields=%5B%22name%22%2C%22paid_amount%22%2C%22docstatus%22%5D`) as { data: unknown[] };
      console.log(`  ترشيح فرعي على ${name}:`, JSON.stringify(r.data).slice(0, 160));
    } catch (e) {
      console.log("  ✗ الترشيح الفرعي:", (e as Error).message.slice(0, 160));
    }
  });
}
process.exit(0);
