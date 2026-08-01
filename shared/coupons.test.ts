import { describe, it, expect } from "vitest";
import { applyCoupon, checkCoupon, normalizeCouponCode, type CouponLike } from "./coupons";
import { VAT_RATE } from "./tax";

const pct = (v: number, extra: Partial<CouponLike> = {}): CouponLike =>
  ({ type: "percent", value: v, scope: "both", ...extra });
const fixed = (v: number, extra: Partial<CouponLike> = {}): CouponLike =>
  ({ type: "fixed", value: v, scope: "both", ...extra });

describe("normalizeCouponCode", () => {
  it("يوحّد الحالة والمسافات", () => {
    expect(normalizeCouponCode(" welcome20 ")).toBe("WELCOME20");
    expect(normalizeCouponCode("we lcome")).toBe("WELCOME");
  });
});

describe("applyCoupon — الحساب", () => {
  it("نسبة مئوية على الصافي", () => {
    const r = applyCoupon(1000, pct(20));
    expect(r.discount).toBe(200);
    expect(r.net).toBe(800);
  });

  it("مبلغ ثابت", () => {
    const r = applyCoupon(1000, fixed(150));
    expect(r.discount).toBe(150);
    expect(r.net).toBe(850);
  });

  // جوهر الصواب هنا: الضريبة على الصافي بعد الخصم لا قبله
  it("الضريبة تُحسب بعد الخصم", () => {
    const r = applyCoupon(1000, pct(20));
    expect(r.vat).toBe(Math.round(800 * VAT_RATE * 100) / 100);
    expect(r.total).toBe(920);
    // لو حُسبت قبل الخصم لكانت 150 بدل 120
    expect(r.vat).not.toBe(150);
  });

  it("الصافي + الضريبة = الإجمالي دائماً", () => {
    for (let net = 50; net <= 3000; net += 7) {
      for (const c of [pct(10), pct(33), fixed(99), fixed(250)]) {
        const r = applyCoupon(net, c);
        expect(Math.round((r.net + r.vat) * 100) / 100).toBe(r.total);
        expect(Math.round((r.netBefore - r.discount) * 100) / 100).toBe(r.net);
      }
    }
  });

  it("الخصم لا يتجاوز المبلغ — لا فواتير سالبة", () => {
    const r = applyCoupon(100, fixed(500));
    expect(r.discount).toBe(100);
    expect(r.net).toBe(0);
    expect(r.total).toBe(0);
  });

  it("يحدّ النسبة بين صفر ومئة", () => {
    expect(applyCoupon(1000, pct(150)).net).toBe(0);
    expect(applyCoupon(1000, pct(-10)).discount).toBe(0);
  });

  it("لا يُنتج كسوراً أطول من منزلتين", () => {
    for (let net = 50; net <= 500; net++) {
      const r = applyCoupon(net, pct(33));
      for (const v of [r.discount, r.net, r.vat, r.total]) {
        expect(Number(v.toFixed(2))).toBe(v);
      }
    }
  });
});

describe("checkCoupon — الصلاحية", () => {
  const base = { scope: "topup" as const, netSar: 500 };

  it("يقبل الكوبون السليم", () => {
    expect(checkCoupon(pct(10), base).ok).toBe(true);
  });

  it("يرفض المعطّل", () => {
    expect(checkCoupon(pct(10, { isActive: false }), base)).toMatchObject({ ok: false });
  });

  it("يرفض خارج النطاق", () => {
    expect(checkCoupon(pct(10, { scope: "subscription" }), base)).toMatchObject({ ok: false });
    expect(checkCoupon(pct(10, { scope: "topup" }), base).ok).toBe(true);
    expect(checkCoupon(pct(10, { scope: "both" }), base).ok).toBe(true);
  });

  it("يرفض المنتهي ويقبل ضمن المدة", () => {
    const now = new Date("2026-06-15");
    expect(checkCoupon(pct(10, { validUntil: "2026-06-01" }), { ...base, now })).toMatchObject({ ok: false });
    expect(checkCoupon(pct(10, { validFrom: "2026-07-01" }), { ...base, now })).toMatchObject({ ok: false });
    expect(checkCoupon(pct(10, { validFrom: "2026-06-01", validUntil: "2026-07-01" }), { ...base, now }).ok).toBe(true);
  });

  it("يرفض المستنفد", () => {
    expect(checkCoupon(pct(10, { maxUses: 5, usedCount: 5 }), base)).toMatchObject({ ok: false });
    expect(checkCoupon(pct(10, { maxUses: 5, usedCount: 4 }), base).ok).toBe(true);
    expect(checkCoupon(pct(10, { maxUses: null, usedCount: 9999 }), base).ok).toBe(true);
  });

  it("يحترم حدّ المبلغ الأدنى", () => {
    expect(checkCoupon(pct(10, { minAmountSar: 1000 }), base)).toMatchObject({ ok: false });
    expect(checkCoupon(pct(10, { minAmountSar: 500 }), base).ok).toBe(true);
  });

  it("سبب الرفض مكتوب للعميل لا للمطوّر", () => {
    const r = checkCoupon(pct(10, { validUntil: "2020-01-01" }), base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("انتهت");
  });
});
