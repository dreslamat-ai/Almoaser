// تحقّق من الحلقة كاملةً على الإنتاج: تذكيرٌ مستحقّ الآن يُكتب في حالة
// التشغيل الحيّة، فيلتقطه جدول العملية العاملة ويرسله على تليجرام.
// يُنتظر حتى دورة الفحص التالية (كل ٥ دقائق) ثم يُقال ما وقع.
import "dotenv/config";
import { readState, writeState } from "../server/stateFile";

type State = { seq: number; items: Array<{ id: number; text: string; everyHours?: number; nextAt: string; createdAt: string }> };

const s = readState<State>("reminders.json", { seq: 0, items: [] });
const id = ++s.seq;
s.items.push({
  id,
  text: "فحصُ التذكيرات — إن وصلتك هذه الرسالة فالجدولة تعمل.",
  nextAt: new Date(Date.now() - 1000).toISOString(),
  createdAt: new Date().toISOString(),
});
if (!writeState("reminders.json", s)) throw new Error("تعذّرت الكتابة في حالة التشغيل");
console.log(`كُتب التذكير #${id} مستحقّاً الآن. في انتظار العملية الحيّة (فحص كل ٥ دقائق)…`);

const started = Date.now();
const deadline = started + 6 * 60_000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 15_000));
  const now = readState<State>("reminders.json", { seq: 0, items: [] });
  if (!now.items.some(x => x.id === id)) {
    console.log(`✓ التقطته العملية بعد ${Math.round((Date.now() - started) / 1000)}ث وأرسلته — راجع تليجرام.`);
    process.exit(0);
  }
}
console.log("✗ ظلّ التذكير في الملفّ ٦ دقائق — الجدول لم يلتقطه.");
process.exit(1);
