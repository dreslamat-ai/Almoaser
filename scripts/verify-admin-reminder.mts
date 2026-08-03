// تحقّق حيّ: يُسأل وكيل الإدارة بنموذج حقيقي «ذكّرني كل ٣ ساعات» فيجب أن
// يستدعي أداة الجدولة لا أن يعتذر بأنها ليست لديه — وهي الشكوى نفسها.
// الردّ يُطبع هنا ولا يُرسل إلى تليجرام.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import { resolveOrgOwnerId } from "../server/organizations";
import { runAdminAgent } from "../server/adminAgent";
import { listReminders, cancelReminder, describeReminder } from "../server/reminders";

const email = process.env.TELEGRAM_OWNER_EMAIL?.trim();
if (!email) throw new Error("TELEGRAM_OWNER_EMAIL غير مضبوط");
const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const owner = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
if (!owner) throw new Error(`لا مستخدم بالبريد ${email}`);

const caller = appRouter.createCaller({
  req: { headers: {} } as never, res: undefined as never,
  user: owner, effectiveUserId: await resolveOrgOwnerId(owner),
} as never);

const before = listReminders().map(r => r.id);
const t0 = Date.now();
const out = await runAdminAgent(caller as never, [
  { role: "user" as const, content: "ذكّرني كل ٣ ساعات أراجع فرق الضريبة في نشاط 53" },
]);
console.log(`\nالردّ (${((Date.now() - t0) / 1000).toFixed(1)}ث):\n${typeof out === "string" ? out : JSON.stringify(out)}\n`);

const added = listReminders().filter(r => !before.includes(r.id));
if (added.length) {
  console.log("✓ جُدول فعلاً:", added.map(describeReminder).join(" | "));
  for (const r of added) cancelReminder(r.id); // فحصٌ لا يترك أثراً
  console.log("  (أُلغي بعد الفحص)");
} else {
  console.log("✗ لم يُجدول شيء — الوكيل لم يستدعِ الأداة");
}
process.exit(added.length ? 0 : 1);
