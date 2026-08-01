import { describe, it, expect } from "vitest";
import {
  resolveMarket, marketFromPhone, formatMoney, withVatRate,
  MARKETS, isMarketCode, DEFAULT_MARKET,
} from "./pricing";

describe("marketFromPhone", () => {
  it("يقرأ السوق من مفتاح الاتصال", () => {
    expect(marketFromPhone("+966501234567")).toBe("SA");
    expect(marketFromPhone("+201001234567")).toBe("EG");
    expect(marketFromPhone("+971501234567")).toBe("AE");
  });

  // +97 بادئة مشتركة: لولا ترتيب الأطول أولاً لابتلعت الإمارات وقطر والبحرين
  it("لا يخلط بين مفاتيح تتشارك البادئة", () => {
    expect(marketFromPhone("+97412345678")).toBe("QA");
    expect(marketFromPhone("+97312345678")).toBe("BH");
    expect(marketFromPhone("+97112345678")).not.toBe("QA");
  });

  it("يعيد undefined لمفتاح لا نسعّر فيه", () => {
    expect(marketFromPhone("+12125551234")).toBeUndefined();
    expect(marketFromPhone("")).toBeUndefined();
    expect(marketFromPhone(null)).toBeUndefined();
  });
});

describe("resolveMarket", () => {
  // اختيار العميل الصريح لا يُتجاوَز بتخمين — من بدّل العملة قال ما يريد
  it("الاختيار الصريح يعلو على الجوال والـIP", () => {
    expect(resolveMarket({ explicit: "EG", phone: "+966501234567", ipCountry: "AE" })).toBe("EG");
  });

  it("الجوال يعلو على الـIP: العميل كتبه بنفسه", () => {
    expect(resolveMarket({ phone: "+201001234567", ipCountry: "SA" })).toBe("EG");
  });

  it("يستعمل الـIP حين لا شيء غيره", () => {
    expect(resolveMarket({ ipCountry: "kw" })).toBe("KW");
  });

  it("يسقط للافتراضي بلا أي إشارة أو بإشارة مجهولة", () => {
    expect(resolveMarket({})).toBe(DEFAULT_MARKET);
    expect(resolveMarket({ explicit: "ZZ", ipCountry: "FR" })).toBe(DEFAULT_MARKET);
  });
});

describe("withVatRate", () => {
  it("١٥٪ على ٤٩٩ ريالاً", () => {
    expect(withVatRate(499, 15)).toEqual({ net: 499, vat: 74.85, total: 573.85 });
  });

  // الضريبة تُشتق بالطرح كي يبقى صافٍ + ضريبة = إجمالي في كل صف
  it("المجموع يطابق الإجمالي دائماً مهما كان الكسر", () => {
    for (const n of [0.01, 33.33, 99.99, 1499, 3500.55]) {
      const r = withVatRate(n, 15);
      expect(Math.round((r.net + r.vat) * 100) / 100).toBe(r.total);
    }
  });

  it("نسبة صفرية تترك المبلغ كما هو", () => {
    expect(withVatRate(500, 0)).toEqual({ net: 500, vat: 0, total: 500 });
  });
});

describe("formatMoney", () => {
  it("يكتب بالأرقام الهندية كبقية الواجهة", () => {
    expect(formatMoney(499, "SA")).toBe("٤٩٩٫٠٠ ريال".replace("٫", "."));
  });

  // الدينار ثلاث خانات لا اثنتان — خطأ يبدو تافهاً ويقرأه أهل السوق فوراً
  it("يحترم خانات كسر كل عملة", () => {
    expect(formatMoney(50, "KW", false)).toBe("50.000 دينار");
    expect(formatMoney(50, "AE", false)).toBe("50.00 درهم");
  });
});

describe("سلامة جدول الأسواق", () => {
  it("كل سوق له عملة واسم عربي", () => {
    for (const [code, m] of Object.entries(MARKETS)) {
      expect(m.code, code).toBe(code);
      expect(m.currency, code).toBeTruthy();
      expect(m.nameAr, code).toBeTruthy();
    }
  });

  it("isMarketCode يرفض ما ليس سوقاً", () => {
    expect(isMarketCode("SA")).toBe(true);
    expect(isMarketCode("sa")).toBe(false);
    expect(isMarketCode(null)).toBe(false);
  });
});
