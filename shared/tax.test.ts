import { describe, it, expect } from "vitest";
import { withVat, VAT_RATE } from "./tax";
import { topupPriceSAR, TOPUP_MIN_CREDITS } from "./credits";

describe("withVat", () => {
  it("يضيف 15% على المبلغ المعلن", () => {
    expect(withVat(100)).toEqual({ net: 100, vat: 15, total: 115 });
    expect(withVat(1000)).toEqual({ net: 1000, vat: 150, total: 1150 });
  });

  it("النسبة هي المعلنة", () => {
    expect(VAT_RATE).toBe(0.15);
    const { net, total } = withVat(200);
    expect(total).toBeCloseTo(net * 1.15, 2);
  });

  // الشرط الجوهري: تقرير الإيرادات يحسب الصافي بـ amount - vatAmount،
  // فلو اختل هذا لظهر صافٍ مخالف للسعر الذي رآه العميل
  it("الصافي + الضريبة = الإجمالي دائماً", () => {
    for (let net = 1; net <= 3000; net++) {
      const { vat, total } = withVat(net);
      expect(Math.round((net + vat) * 100) / 100).toBe(total);
      expect(Math.round((total - vat) * 100) / 100).toBe(net);
    }
  });

  it("لا يتجاوز منزلتين عشريتين", () => {
    for (let net = 1; net <= 1000; net++) {
      const { vat, total } = withVat(net);
      expect(Number(total.toFixed(2))).toBe(total);
      expect(Number(vat.toFixed(2))).toBe(vat);
    }
  });

  it("يتعامل مع الصفر", () => {
    expect(withVat(0)).toEqual({ net: 0, vat: 0, total: 0 });
  });
});

describe("الضريبة على شحن النقاط", () => {
  it("أقل شحنة: 500 نقطة = 100 ريال + 15 ضريبة", () => {
    const { net, vat, total } = withVat(topupPriceSAR(TOPUP_MIN_CREDITS));
    expect(net).toBe(100);
    expect(vat).toBe(15);
    expect(total).toBe(115);
  });

  it("طرح الضريبة من الإجمالي يعيد السعر المعلن لأي عدد نقاط", () => {
    for (let c = TOPUP_MIN_CREDITS; c <= TOPUP_MIN_CREDITS + 500; c++) {
      const listed = topupPriceSAR(c);
      const { vat, total } = withVat(listed);
      expect(Math.round((total - vat) * 100) / 100).toBe(listed);
    }
  });
});
