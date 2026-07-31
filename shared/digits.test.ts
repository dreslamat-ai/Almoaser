import { describe, it, expect } from "vitest";
import { toArabicDigits, toLatinDigits, digitsOnly } from "./digits";

describe("toArabicDigits", () => {
  it("يحوّل الأرقام اللاتينية", () => {
    expect(toArabicDigits("50")).toBe("٥٠");
    expect(toArabicDigits(1234567890)).toBe("١٢٣٤٥٦٧٨٩٠");
  });

  it("يترك ما ليس رقماً كما هو", () => {
    expect(toArabicDigits("50 نقطة")).toBe("٥٠ نقطة");
    expect(toArabicDigits("1,500")).toBe("١,٥٠٠");
  });

  it("لا يغيّر نصاً بلا أرقام", () => {
    expect(toArabicDigits("نقطة")).toBe("نقطة");
    expect(toArabicDigits("")).toBe("");
  });
});

describe("toLatinDigits", () => {
  it("يقبل الأرقام العربية", () => {
    expect(toLatinDigits("٥٠")).toBe("50");
  });

  it("يقبل الأرقام الفارسية", () => {
    expect(toLatinDigits("۵۰")).toBe("50");
  });

  it("يمرّر اللاتينية كما هي", () => {
    expect(toLatinDigits("50")).toBe("50");
  });

  it("يتعامل مع الخلط بين الأنظمة", () => {
    expect(toLatinDigits("١2٣")).toBe("123");
  });
});

describe("digitsOnly", () => {
  it("يستخرج الأرقام من إدخال حرّ بأي نظام", () => {
    expect(digitsOnly("٥٠ نقطة")).toBe("50");
    expect(digitsOnly("1,500 ريال")).toBe("1500");
    expect(digitsOnly("۵۰")).toBe("50");
  });

  it("يرفض ما لا رقم فيه", () => {
    expect(digitsOnly("نقطة")).toBe("");
    expect(digitsOnly("abc")).toBe("");
  });

  it("يمنع الإشارات والفواصل العشرية — النقاط أعداد صحيحة", () => {
    expect(digitsOnly("-50")).toBe("50");
    expect(digitsOnly("50.7")).toBe("507");
  });
});
