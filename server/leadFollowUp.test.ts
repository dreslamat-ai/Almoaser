import { describe, it, expect } from "vitest";
import { buildDigestHtml, STALE_HOURS, GIVE_UP_DAYS } from "./leadFollowUp";

const lead = (o: Partial<Parameters<typeof buildDigestHtml>[0][number]> = {}) => ({
  id: 1, name: "أحمد", phone: null, city: null, activity: null,
  employees: null, createdAt: new Date(), hoursWaiting: 24, ...o,
});

describe("ملخّص العملاء المحتملين", () => {
  // من ترك جواله أبدى نيّة أوضح — يجب أن يُرى أولاً لا أن يُدفن تحت الأحدث
  it("يقدّم من ترك جوالاً على من لم يتركه", () => {
    const html = buildDigestHtml([
      lead({ id: 1, name: "بلا جوال", hoursWaiting: 100 }),
      lead({ id: 2, name: "بجوال", phone: "+966501234567", hoursWaiting: 24 }),
    ]);
    expect(html.indexOf("بجوال")).toBeLessThan(html.indexOf("بلا جوال"));
  });

  it("يعرّب الأرقام كبقية الواجهة", () => {
    expect(buildDigestHtml([lead({ hoursWaiting: 25 })])).toContain("٢٥ ساعة");
  });

  it("يعلّم غياب الجوال بدل ترك خانة فارغة تُقرأ كخطأ", () => {
    expect(buildDigestHtml([lead()])).toContain("لا جوال");
  });

  // اسم عميل فيه قوس زاوية لا يجب أن يكسر البريد أو يحقن وسماً
  it("يهرّب المحارف الخاصة في بيانات العميل", () => {
    const html = buildDigestHtml([lead({ name: '<img src=x onerror="alert(1)">' })]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("يذكر كيف يتوقف التذكير — وإلا تكرّر على من عولج", () => {
    expect(buildDigestHtml([lead()])).toContain("يوقف تذكيره");
  });
});

describe("حدود المتابعة", () => {
  // التذكير الفوري ضجيج: العميل قد يكون يكتب الآن
  it("لا يذكّر قبل مرور وقت معقول", () => {
    expect(STALE_HOURS).toBeGreaterThanOrEqual(12);
  });

  // ومن لم يُتابَع شهراً لا يعالجه تذكير يومي — يسقط من الطابور
  it("يتوقّف عن التذكير بعد مدة", () => {
    expect(GIVE_UP_DAYS).toBeLessThanOrEqual(60);
  });
});
