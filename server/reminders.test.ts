// التذكيرات: ما يُجدول يصل مرّة في موعده، ولا يُنتج الانقطاعُ دفعةً متلاحقة.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// مجلّد حالة معزول: لا يمسّ تذكيرات المالك الحقيقية
const DIR = mkdtempSync(join(tmpdir(), "almoaser-state-"));
process.env.STATE_DIR = DIR;

const { statePath, writeState, readState } = await import("./stateFile");
const { addReminder, listReminders, cancelReminder, takeDueReminders, describeReminder } = await import("./reminders");

const H = 3600_000;

beforeEach(() => { writeState("reminders.json", { seq: 0, items: [] }); });
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); });

describe("مجلّد الحالة", () => {
  // المسار السابق كان في بيت مستخدم آخر، فكانت كل كتابة تفشل بصمت
  // وتُقرأ الحالة فارغةً دائماً — فبدا التكرار مُصلَحاً وهو قائم.
  it("يكتب على القرص فعلاً ويُقرأ كما كُتب", () => {
    expect(writeState("probe.json", { t: 1 })).toBe(true);
    expect(existsSync(statePath("probe.json"))).toBe(true);
    expect(readState<{ t: number }>("probe.json", { t: 0 }).t).toBe(1);
  });
});

describe("التذكيرات", () => {
  it("يجدول تذكيراً متكرّراً بموعد أوّل صحيح", () => {
    const r = addReminder("راجع فرق الضريبة", 3);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.everyHours).toBe(3);
    expect((new Date(r.nextAt).getTime() - Date.now()) / H).toBeCloseTo(3, 1);
    expect(describeReminder(r)).toContain("كل 3 ساعة");
  });

  it("يرفض ما لا يصلح تكراراً أو نصّاً", () => {
    expect(addReminder("س", 0)).toHaveProperty("error");
    expect(addReminder("س", 999)).toHaveProperty("error");
    expect(addReminder("   ")).toHaveProperty("error");
  });

  it("لا يستحقّ شيء قبل موعده", () => {
    addReminder("لاحقاً", 3);
    expect(takeDueReminders()).toHaveLength(0);
    expect(listReminders()).toHaveLength(1);
  });

  it("يحذف المرّة الواحدة ويُبقي المتكرّر بعد الإرسال", () => {
    addReminder("متكرّر", 3);
    addReminder("مرّة", undefined, 1);
    const later = new Date(Date.now() + 4 * H);
    expect(takeDueReminders(later)).toHaveLength(2);
    const rest = listReminders();
    expect(rest).toHaveLength(1);
    expect(rest[0].everyHours).toBe(3);
  });

  it("يحسب الموعد التالي من لحظة الإرسال لا من الموعد الفائت", () => {
    // انقطاعٌ طويل يجب ألّا يُنتج دفعةً متلاحقة تقضي دَين الساعات الفائتة
    addReminder("متكرّر", 3);
    const muchLater = new Date(Date.now() + 40 * H);
    expect(takeDueReminders(muchLater)).toHaveLength(1);
    const next = new Date(listReminders()[0].nextAt).getTime();
    expect((next - muchLater.getTime()) / H).toBeCloseTo(3, 1);
    // ولا يستحقّ ثانيةً في اللحظة نفسها
    expect(takeDueReminders(muchLater)).toHaveLength(0);
  });

  it("يوقف برقمه ولا يدّعي إيقاف ما لا وجود له", () => {
    const r = addReminder("س", 3);
    if ("error" in r) throw new Error("لم يُجدول");
    expect(cancelReminder(r.id)).toBe(true);
    expect(cancelReminder(9999)).toBe(false);
    expect(listReminders()).toHaveLength(0);
  });

  it("يبقى بين إعادات التشغيل — الحالة على القرص لا في الذاكرة", async () => {
    addReminder("يبقى", 3);
    const raw = readState<{ items: unknown[] }>("reminders.json", { items: [] });
    expect(raw.items).toHaveLength(1);
  });
});
