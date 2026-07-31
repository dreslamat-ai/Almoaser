import { describe, it, expect } from "vitest";
import { isValidTopupCredits, topupPriceSAR, TOPUP_MIN_CREDITS, TOPUP_MAX_CREDITS, CREDITS_PER_SAR } from "./credits";
import { formatSAR } from "../shared/credits";

describe("isValidTopupCredits", () => {
  it("يقبل الحد الأدنى", () => {
    expect(isValidTopupCredits(TOPUP_MIN_CREDITS)).toBe(true);
  });

  it("يرفض ما دون الحد الأدنى", () => {
    expect(isValidTopupCredits(TOPUP_MIN_CREDITS - 1)).toBe(false);
    expect(isValidTopupCredits(1)).toBe(false);
    expect(isValidTopupCredits(0)).toBe(false);
    expect(isValidTopupCredits(-100)).toBe(false);
  });

  // جوهر التعديل: الشحن كان محصوراً في مضاعفات 100
  it("يقبل أي عدد صحيح فوق الحد، لا مضاعفات 100 فقط", () => {
    expect(isValidTopupCredits(50)).toBe(true);
    expect(isValidTopupCredits(60)).toBe(true);
    expect(isValidTopupCredits(137)).toBe(true);
    expect(isValidTopupCredits(999)).toBe(true);
  });

  it("يرفض الكسور", () => {
    expect(isValidTopupCredits(50.5)).toBe(false);
    expect(isValidTopupCredits(100.1)).toBe(false);
  });

  it("يرفض ما ليس عدداً", () => {
    expect(isValidTopupCredits(NaN)).toBe(false);
    expect(isValidTopupCredits(Infinity)).toBe(false);
  });

  it("يحترم السقف", () => {
    expect(isValidTopupCredits(TOPUP_MAX_CREDITS)).toBe(true);
    expect(isValidTopupCredits(TOPUP_MAX_CREDITS + 1)).toBe(false);
  });
});

describe("topupPriceSAR", () => {
  it("الريال يشتري خمس نقاط", () => {
    expect(topupPriceSAR(5)).toBe(1);
    expect(topupPriceSAR(50)).toBe(10);
    expect(topupPriceSAR(100)).toBe(20);
    expect(topupPriceSAR(500)).toBe(100);
  });

  it("يسعّر ما لا يقبل القسمة على خمسة بكسر عشري", () => {
    expect(topupPriceSAR(137)).toBe(27.4);
    expect(topupPriceSAR(51)).toBe(10.2);
    expect(topupPriceSAR(53)).toBe(10.6);
  });

  // عمود المبلغ decimal(10,2) ولا يقبل ذيلاً عشرياً طويلاً من القسمة
  it("لا يُسرِّب أخطاء الفاصلة العائمة", () => {
    for (let c = TOPUP_MIN_CREDITS; c <= 300; c++) {
      const price = topupPriceSAR(c);
      expect(Number(price.toFixed(2))).toBe(price);
    }
  });

  it("متسق مع السعر المعلن", () => {
    expect(topupPriceSAR(CREDITS_PER_SAR)).toBe(1);
  });
});

describe("formatSAR", () => {
  it("يحذف الصفر العشري الزائد", () => {
    expect(formatSAR(10)).toBe("10");
    expect(formatSAR(100)).toBe("100");
  });

  it("يبقي الكسر عند وجوده", () => {
    expect(formatSAR(27.4)).toBe("27.4");
    expect(formatSAR(10.2)).toBe("10.2");
  });
});
