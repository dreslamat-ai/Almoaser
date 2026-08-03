// استجواب سارة كما يفعل صاحب النظام: نفس الأسئلة على كلا الموديلين،
// ويُطبع الردّ والزمن والأدوات التي نُوديت — ليُقارن بالعين لا بالظنّ.
//
// لا كتابة: الأسئلة كلّها قراءة، وتُفحص الأدوات المُناداة للتأكّد.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users, erpnextConnections } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import { resolveOrgOwnerId } from "../server/organizations";

const WRITE = /create|update|delete|submit|cancel|payment_entry|make_/i;

const QUESTIONS = [
  "كام فاتورة عندي؟",
  "مين آخر عميل سجلته؟",
  "اعرضلي الفواتير غير المدفوعة",
  "إجمالي مبيعاتي كام؟",
];

const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const conn = (await db.select().from(erpnextConnections).limit(1))[0];
const user = (await db.select().from(users).where(eq(users.id, conn.userId)).limit(1))[0];
if (!user) throw new Error("لا مستخدم");

const caller = appRouter.createCaller({
  req: { headers: {} } as never, res: undefined as never,
  user, effectiveUserId: await resolveOrgOwnerId(user),
} as never);

const orders: Array<[string, string]> = [
  ["الكبير أوّلاً (الحال الآن)", "qwen/qwen3.5-397b-a17b,deepseek/deepseek-v4-flash"],
  ["السريع أوّلاً", "deepseek/deepseek-v4-flash,qwen/qwen3.5-397b-a17b"],
];

for (const [label, chain] of orders) {
  process.env.LLM_MODEL = chain;
  console.log(`\n${"═".repeat(70)}\n${label}\n${"═".repeat(70)}`);
  let total = 0;
  for (const q of QUESTIONS) {
    const t0 = Date.now();
    try {
      const r = await caller.agent.chat({ messages: [{ role: "user" as const, content: q }] }) as {
        reply?: string; toolResults?: Array<{ name?: string }>; provider?: string;
      };
      const ms = Date.now() - t0;
      total += ms;
      const tools = (r.toolResults ?? []).map(t => t.name ?? "?");
      const wrote = tools.filter(t => WRITE.test(t));
      console.log(`\nس: ${q}\n   ${r.provider ?? "—"} · ${ms}ms · ${tools.length ? "أدوات: " + tools.join("، ") : "بلا أدوات"}${wrote.length ? ` · ⚠ كتابة: ${wrote.join("، ")}` : ""}`);
      console.log("   " + String(r.reply ?? "").replace(/\n/g, "\n   ").slice(0, 400));
    } catch (e) {
      const ms = Date.now() - t0;
      total += ms;
      console.log(`\nس: ${q}\n   ✗ تعثّرت بعد ${ms}ms: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log(`\nالمجموع: ${(total / 1000).toFixed(1)}ث لأربعة أسئلة`);
}
process.exit(0);
