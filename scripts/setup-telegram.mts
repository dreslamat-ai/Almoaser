// ضبط إشعارات تيليجرام لصاحب المنصة.
//
//   npx tsx scripts/setup-telegram.mts <bot-token>
//
// يقرأ معرّف المحادثة من رسائل البوت الواردة بدل أن تبحث عنه بنفسك، يكتب
// المتغيّرين في .env، ويرسل رسالة تحقّق. لا يُكتب شيء قبل نجاح الإرسال:
// إعدادٌ محفوظ لا يعمل أسوأ من إعداد غائب — الأول يُظنّ سليماً.
import "dotenv/config";
import { readFileSync, writeFileSync, chmodSync } from "fs";
import { discoverChatId } from "../server/telegram";

const ENV = "/home/almoaser-ai/apps/almoaser-ai/.env";
const token = process.argv[2]?.trim();

if (!token) {
  console.log(`
الاستعمال: npx tsx scripts/setup-telegram.mts <bot-token>

للحصول على التوكن:
  ١) افتح تيليجرام وابحث عن @BotFather
  ٢) أرسل /newbot واتبع الخطوات (اسم البوت ثم معرّفه المنتهي بـ bot)
  ٣) ينسخ لك سطراً مثل 8123456789:AAH...  — هو التوكن
  ٤) افتح بوتك الجديد وأرسل له /start  ← خطوة ضرورية، بدونها لا يعرف إلى أين يرسل
  ٥) شغّل هذا الأمر ومعه التوكن
`);
  process.exit(1);
}

if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
  console.error("✗ شكل التوكن غير صحيح — انسخه من BotFather كاملاً بلا مسافات");
  process.exit(1);
}

console.log("▶ البحث عن المحادثات الواردة…");
const found = await discoverChatId(token);
if (!found.ok) {
  console.error(`✗ ${found.error}`);
  process.exit(1);
}

// أكثر من محادثة: نأخذ الأحدث ونعلن أيّها اختير بدل أن نختار بصمت
const chat = found.chats[found.chats.length - 1];
if (found.chats.length > 1) {
  console.log(`  وُجدت ${found.chats.length} محادثات: ${found.chats.map(c => c.title).join("، ")}`);
}
console.log(`✓ المحادثة: ${chat.title} (${chat.id})`);

// التحقق قبل الحفظ لا بعده
process.env.TELEGRAM_BOT_TOKEN = token;
process.env.TELEGRAM_CHAT_ID = chat.id;
const { sendTelegram } = await import("../server/telegram");
const test = await sendTelegram(
  "<b>المعاصر AI</b>\nتم ربط تيليجرام بنجاح ✅\nستصلك هنا تذكيرات العملاء المحتملين وتنبيهات التشغيل.",
);
if (!test.ok) {
  console.error(`✗ فشل إرسال رسالة التحقق: ${test.error}`);
  console.error("  لم يُحفظ شيء في .env");
  process.exit(1);
}
console.log("✓ وصلت رسالة التحقق");

const lines = readFileSync(ENV, "utf8").split("\n");
const upsert = (key: string, value: string) => {
  const i = lines.findIndex(l => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
};
if (!lines.some(l => l.includes("إشعارات تيليجرام"))) {
  lines.push("", "# إشعارات تيليجرام لصاحب المنصة (تذكيرات العملاء المحتملين)");
}
upsert("TELEGRAM_BOT_TOKEN", token);
upsert("TELEGRAM_CHAT_ID", chat.id);
writeFileSync(ENV, lines.join("\n"));
chmodSync(ENV, 0o660);

console.log("✓ حُفظ في .env — أعد التشغيل ليقرأه: almoaser restart");
process.exit(0);
