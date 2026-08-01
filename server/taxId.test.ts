import { describe, it, expect } from "vitest";
import { validateTaxId, normalizeTaxId, countryToTaxIdCountry } from "./taxId";

describe("normalizeTaxId", () => {
  it("يحوّل الأرقام العربية إلى إنجليزية", () => {
    expect(normalizeTaxId("٣١٠١٢٣٤٥٦٧٨٩٠٠٣")).toBe("310123456789003");
  });
  it("يحذف المسافات والشرطات", () => {
    expect(normalizeTaxId("310 123-456 789 003")).toBe("310123456789003");
  });
});

describe("validateTaxId — السعودية", () => {
  // النمط الحقيقي المرصود في أنظمة عملاء: الرقم المميز (10 خانات) + 00003
  it("يقبل رقماً سعودياً صحيح الصيغة", () => {
    for (const n of ["314533971400003", "310770533900003", "300235269200003"]) {
      expect(validateTaxId(n, "SA").valid).toBe(true);
    }
  });

  // كان الفحص يشترط البداية بـ 3 فيرفض رقماً يعمل به عميل فعلاً
  it("يقبل رقماً لا يبدأ بـ 3 ما دام على النمط", () => {
    expect(validateTaxId("258941285800003", "SA").valid).toBe(true);
  });

  it("يرفض طولاً غير 15", () => {
    const r = validateTaxId("31012345678900", "SA");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("15");
  });

  it("يرفض ما لا ينتهي بـ 00003", () => {
    const r = validateTaxId("310123456789003", "SA");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("00003");
  });

  it("يرفض ما لا ينتهي بـ 3", () => {
    const r = validateTaxId("310123456789005", "SA");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("ينتهي");
  });

  it("يرفض رقماً كل خاناته متطابقة (مفبرك)", () => {
    const r = validateTaxId("333333333333333", "SA");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("متطابقة");
  });

  it("يرفض رقماً متسلسلاً (تجريبي/مفبرك)", () => {
    const r = validateTaxId("312345678901233", "SA");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("متسلسل");
  });

  it("يرفض ما يحتوي حروفاً", () => {
    const r = validateTaxId("3101234567890AB", "SA");
    expect(r.valid).toBe(false);
  });

  it("يرفض الفراغ", () => {
    expect(validateTaxId("", "SA").valid).toBe(false);
  });

  it("لا يدّعي التحقق الفعلي من التسجيل لدى الهيئة", () => {
    const r = validateTaxId("314533971400003", "SA");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.note).toMatch(/لا توجد واجهة رسمية|يدوي/);
  });
});

describe("validateTaxId — مصر والإمارات", () => {
  it("يقبل رقماً مصرياً من 9 أرقام", () => {
    expect(validateTaxId("204851739", "EG").valid).toBe(true);
  });

  it("لا يرفض رقماً حقيقياً يصادف أن جزءاً منه متتالٍ (تجنّب الإنذار الكاذب)", () => {
    // فحص التسلسل على "القلب" مقصور على السعودية بطول 15، فلا يطبَّق هنا
    expect(validateTaxId("123456780", "EG").valid).toBe(true);
    expect(validateTaxId("100234567891012", "AE").valid).toBe(true);
  });
  it("يرفض رقماً مصرياً بطول خاطئ", () => {
    expect(validateTaxId("12345", "EG").valid).toBe(false);
  });
  it("يقبل TRN إماراتياً يبدأ بـ 100", () => {
    expect(validateTaxId("100123456789012", "AE").valid).toBe(true);
  });
  it("يرفض TRN إماراتياً لا يبدأ بـ 100", () => {
    const r = validateTaxId("200123456789012", "AE");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("100");
  });
});

describe("countryToTaxIdCountry", () => {
  it("يتعرّف على السعودية بالعربية والإنجليزية", () => {
    expect(countryToTaxIdCountry("Saudi Arabia")).toBe("SA");
    expect(countryToTaxIdCountry("المملكة العربية السعودية")).toBe("SA");
  });
  it("يتعرّف على مصر والإمارات", () => {
    expect(countryToTaxIdCountry("Egypt")).toBe("EG");
    expect(countryToTaxIdCountry("United Arab Emirates")).toBe("AE");
  });
  it("يرجع OTHER لبلد غير معروف أو فارغ", () => {
    expect(countryToTaxIdCountry("Oman")).toBe("OTHER");
    expect(countryToTaxIdCountry(null)).toBe("OTHER");
  });
});
