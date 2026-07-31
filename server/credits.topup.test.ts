import { describe, it, expect } from "vitest";
import { isValidTopupCredits, topupPriceSAR, TOPUP_MIN_CREDITS, TOPUP_MAX_CREDITS } from "./credits";

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
  it("النقطة بريال", () => {
    expect(topupPriceSAR(50)).toBe(50);
    expect(topupPriceSAR(100)).toBe(100);
    expect(topupPriceSAR(500)).toBe(500);
  });

  it("يسعّر الأعداد غير المضاعفة بلا تقريب", () => {
    expect(topupPriceSAR(137)).toBe(137);
    expect(topupPriceSAR(60)).toBe(60);
  });
});
