import { describe, it, expect } from "vitest";
import { normalizePhone, maskPhone } from "./phone";

describe("normalizePhone — السعودية", () => {
  const expected = "+966501234567";

  it.each([
    ["05 0123 4567", "بمسافات"],
    ["0501234567", "الصيغة المحلية"],
    ["501234567", "بدون صفر"],
    ["+966501234567", "E.164"],
    ["966501234567", "بدون +"],
    ["00966501234567", "بادئة 00"],
    ["+966 50 123 4567", "دولي بمسافات"],
    ["050-123-4567", "بشُرَط"],
    ["+966501234567 ", "بمسافة زائدة"],
  ])("يقبل %s (%s)", input => {
    const r = normalizePhone(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe(expected);
  });

  it("يقبل ‎+96605… (صفر زائد بعد رمز الدولة)", () => {
    const r = normalizePhone("+9660501234567");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe(expected);
  });

  it("يحوّل الأرقام العربية", () => {
    const r = normalizePhone("٠٥٠١٢٣٤٥٦٧");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe(expected);
  });

  it("يعيد الصيغة المحلية للعرض", () => {
    const r = normalizePhone("+966501234567");
    if (r.ok) expect(r.national).toBe("0501234567");
  });

  it.each([
    ["0401234567", "لا يبدأ بـ 5"],
    ["05012345", "قصير"],
    ["05012345678", "طويل"],
    ["", "فارغ"],
    ["abc", "حروف"],
  ])("يرفض %s (%s)", input => {
    expect(normalizePhone(input).ok).toBe(false);
  });
});

describe("normalizePhone — دولي", () => {
  it("يقبل رقماً مصرياً", () => {
    const r = normalizePhone("+201001234567");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe("+201001234567");
  });

  it("يقبل رقماً إماراتياً", () => {
    const r = normalizePhone("00971501234567");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe("+971501234567");
  });

  it("يرفض رقماً دولياً قصيراً", () => {
    expect(normalizePhone("+12345").ok).toBe(false);
  });

  it("يرفض رقماً بلا رمز دولة ولا صيغة سعودية", () => {
    expect(normalizePhone("1234567890").ok).toBe(false);
  });
});

describe("maskPhone", () => {
  it("يخفي الوسط ويُبقي البداية والنهاية", () => {
    const masked = maskPhone("+966501234567");
    expect(masked.startsWith("+9665")).toBe(true);
    expect(masked.endsWith("567")).toBe(true);
    expect(masked).not.toContain("0123");
  });
});
