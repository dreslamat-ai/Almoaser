// مجلّد الحالة يُقرأ عند كل نداء، لا مرّةً وقت التحميل.
//
// **لماذا اختبارٌ لسطرٍ واحد:** لأن كسره لا يظهر كعطل. فحصُ فريق المراجعة
// يضبط `STATE_DIR` على مجلّدٍ مؤقّت ثم يستورد `reminders` ظنّاً أنه يعزل
// نفسه؛ ولمّا كان المجلّد ثابتاً يُحسب وقت الاستيراد الأوّل، كتب الفحصُ
// تذكيراته في قائمة المالك الحقيقية بلا خطأ ولا سطرٍ في السجلّ. النتيجة
// المقيسة في ٥ أغسطس ٢٠٢٦: **عشرة تذكيرات «فحصُ الفريق»** تصل كل ثلاث
// ساعات دفعةً واحدة، تنمو واحداً كل تشغيلة.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { statePath, writeState, readState } from "./stateFile";

const created: string[] = [];
const fresh = () => {
  const d = mkdtempSync(join(tmpdir(), "state-isolation-"));
  created.push(d);
  return d;
};

afterEach(() => {
  delete process.env.STATE_DIR;
  while (created.length) rmSync(created.pop()!, { recursive: true, force: true });
  //ولو تسرّبت الكتابة إلى المجلّد الحقيقي فقد رُصدت في التوكيد سلفاً — تُمسح
  //هنا لئلّا يفشل التشغيل التالي بأثرِ تشغيلٍ سابق بدل عطلٍ قائم.
  rmSync(statePath("isolation-probe.json"), { force: true });
});

describe("عزل مجلّد الحالة", () => {
  it("يحترم STATE_DIR المضبوط بعد تحميل الوحدة", () => {
    const d = fresh();
    process.env.STATE_DIR = d;
    expect(statePath("reminders.json").startsWith(d)).toBe(true);
  });

  it("لا يكتب في المجلّد الحقيقي حين يكون معزولاً", () => {
    const real = statePath("isolation-probe.json");
    const d = fresh();
    process.env.STATE_DIR = d;

    writeState("isolation-probe.json", { touched: true });

    expect(existsSync(join(d, "isolation-probe.json"))).toBe(true);
    expect(existsSync(real)).toBe(false);
  });

  it("يعود للمجلّد الحقيقي بعد رفع العزل", () => {
    const d = fresh();
    process.env.STATE_DIR = d;
    const isolated = statePath("reminders.json");
    delete process.env.STATE_DIR;

    expect(statePath("reminders.json")).not.toBe(isolated);
  });

  it("القراءة من المعزول لا ترى ما في الحقيقي", () => {
    const d = fresh();
    process.env.STATE_DIR = d;
    const back = readState<{ items: unknown[] }>("reminders.json", { items: [] });
    expect(back.items).toEqual([]);
  });
});
