// يسجّل ما تبقّى من طلباتٍ سابقة في قائمة مهامّ المالك — «خليه في المهام».
// ما يبقى في محادثةٍ وحدها يضيع بانتهائها؛ وما يُسجَّل يُسأل عنه ويُقفل.
// يتخطّى ما سُجّل من قبل بمطابقة العنوان، فتكرار تشغيله لا يُكرّر شيئاً.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import { resolveOrgOwnerId } from "../server/organizations";

type Item = { title: string; description: string; priority: "low" | "medium" | "high" | "urgent" };

const BACKLOG: Item[] = [
  {
    title: "[أمن · AlmoaserPos] تدوير APP_KEY وكلمة سرّ قاعدة البيانات",
    description: "ملفّ مضغوط للموقع كاملاً وفيه .env كان قابلاً للتنزيل من الإنترنت. حُذف، ولا يُعرف من نزّله قبل الحذف. التدوير قرارُك لأنه يقطع الجلسات القائمة.",
    priority: "urgent",
  },
  {
    title: "[أمن · AlmoaserPos] عبارة مرور النسخ الاحتياطي على الخادم نفسه",
    description: "العبارة في /home/eipsys/.config/backup-passphrase على الخادم الذي تُنسخ منه — من فقد الخادم فقد النسخة معه. والرفع الخارجي يفشل حالياً.",
    priority: "high",
  },
  {
    title: "[شهد] نظام النقاط: شحن يدوي بجانب البوابة داخل سوبر أدمن",
    description: "طلبك: نقاط مع شحن يدوي مؤقّت بجانب البوابة، داخل سوبر أدمن مع إدارة الاشتراكات، وتظهر عند العملاء. أُجّل حتى نراجع النقاط بعد إرجاع شهد للقراءة فقط.",
    priority: "high",
  },
  {
    title: "[الاشتراكات] مراجعة بوابة MyFatoorah",
    description: "قلتَ إنها ضرورية. لم تُراجَع بعد.",
    priority: "high",
  },
  {
    title: "[الباقات] المشتركون الحاليون لديهم مستويا شهد معاً",
    description: "أُعطي كل المشتركين الحاليين المستويين مؤقّتاً حتى تُعاد صياغة الباقات — قرارٌ مؤقّت ينتظر تصميم الباقات الجديد.",
    priority: "medium",
  },
  {
    title: "[شهد] شهادة الضريبة تظلّ على «جاري القراءة»",
    description: "قارئ شهادة الضريبة لا يُنهي القراءة ولا يقول لماذا.",
    priority: "medium",
  },
  {
    title: "[شهد] لا قارئ لصور بيانات العملاء",
    description: "ثغرة ظهرت من شكوى عميل: هناك قارئ للفواتير وآخر لشهادة الضريبة، ولا شيء يقرأ صورة فيها بيانات عميل ليُدخلها.",
    priority: "medium",
  },
  {
    title: "[نصوص] «تواصل مع مسؤول النظام» تُحيل العميل إلينا نحن",
    description: "الرسالة تطلب من العميل أن يتواصل مع جهةٍ نحن هي — فلا يعرف بمن يتّصل.",
    priority: "low",
  },
  {
    title: "[تشغيل] إعادة تحميل ecosystem لتفعيل kill_timeout",
    description: "pm2 delete almoaser-ai && pm2 start ecosystem.config.cjs && pm2 save — إعادة التشغيل العادية لا تلتقط التغيير.",
    priority: "low",
  },
  {
    title: "[استهلاك] OPENAI_ADMIN_KEY ليظهر رصيد OpenAI",
    description: "الرصيد يُعرض الآن «تعذّر» بدل صفر، ولن يُقرأ حتى يُضبط المفتاح الإداري.",
    priority: "low",
  },
  {
    title: "[AlmoaserPos] جدولان عريضان في Modules/Project بلا id",
    description: "invoice/partials/invoice_line_table.blade.php و reports/partials/project_timelog.blade.php — سبعة أعمدة بلا معرّف، فلا يسكرولان داخل إطارهما. خارج ما يفحصه المعاين لأن صفحاته العشر لا تُرندر وحدة Project.",
    priority: "low",
  },
  {
    title: "[شهد] حادثة «اضغط… حذف» غير محسومة",
    description: "بلاغٌ قديم من مراقب شهد لم يُثبت ولا يُنفَ: ردّ النموذج مقصوص عند 110 حرفاً في السجلّ، وثلاثة استجوابات لاحقة لم تُعده. يبقى مفتوحاً حتى يتكرّر أو يُطوَّل السجلّ.",
    priority: "low",
  },
  {
    title: "[المعاين] سطح الكشف أصغر بعد التحويل إلى قياس المُرنْدَر",
    description: "المعاين صار يقيس عشر صفحات مُرنْدَرة بدل مسح كل القوالب نصّياً — أدقّ اليوم (صفر جدول عريض) لكن قالبٌ جديد لا تفتحه الصفحات العشر لن يُرى.",
    priority: "low",
  },
  {
    title: "[AlmoaserPos] صفحة الدفع بعد التسجيل بنفس مرض الصفحتين",
    description: "superadmin::subscription.pay — بطاقة 1110 ومحتواها في اليمين وحده، ونصّ إنجليزي (1 Months / SAR 500.00)، وأزرار 34 بكسل. آخر خطوة في رحلة التسجيل التي أُصلحت، فالتناقض بينها وبين ما قبلها ظاهر.",
    priority: "high",
  },
  {
    title: "[AlmoaserPos] التحويل لبوابة الدفع صار يعمل بعد إصلاح package_id",
    description: "كان `?package_id=` يسقط صامتاً فلا يُختار اشتراك بعد التسجيل. بعد الإصلاح يعمل التحويل إلى صفحة الدفع (تُحقّق منها بقراءة: GET /subscription/3/register-pay ردّ 200 بحساب مالك عادي). راقب أوّل تسجيلات حقيقية.",
    priority: "high",
  },
  {
    title: "[AlmoaserPos] layouts/auth و auth2 مكرّران",
    description: "auth ليس ميتاً — يخدم صفحة الدفع بعد التسجيل عبر $layout نصّاً في SubscriptionController:151. دمجهما يمسّ ست صفحات لعملاء.",
    priority: "low",
  },
];

const email = process.env.TELEGRAM_OWNER_EMAIL?.trim();
if (!email) throw new Error("TELEGRAM_OWNER_EMAIL غير مضبوط");
const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const owner = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
if (!owner) throw new Error(`لا مستخدم بالبريد ${email}`);
if (owner.role !== "admin") throw new Error("المالك ليس admin — createTaskForOwner سيرفض");

const caller = appRouter.createCaller({
  req: { headers: {} } as never, res: undefined as never,
  user: owner, effectiveUserId: await resolveOrgOwnerId(owner),
} as never);

const existing = (await caller.admin.tasks().catch(() => [])) as Array<{ title: string }>;
const have = new Set(existing.map(t => t.title));

let added = 0;
for (const item of BACKLOG) {
  if (have.has(item.title)) { console.log(`· مسجّلة سلفاً: ${item.title}`); continue; }
  await caller.admin.createTaskForOwner({ title: item.title, description: item.description, priority: item.priority, type: "other" });
  console.log(`✓ ${item.title}`);
  added++;
}
console.log(`\nأُضيفت ${added} مهمّة من ${BACKLOG.length}.`);
process.exit(0);
