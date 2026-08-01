import { describe, it, expect } from "vitest";
import { planCapacityLabel, planCapacityDetail, isExpertPlan } from "./planDisplay";

const expert = { mode: "expert", maxDocuments: 0, monthlyCredits: 1000 };
const accounting = { mode: "accounting", maxDocuments: 50, monthlyCredits: 250 };

describe("باقة الخبير", () => {
  it("تُعرف بوضعها", () => {
    expect(isExpertPlan(expert)).toBe(true);
    expect(isExpertPlan(accounting)).toBe(false);
  });

  // الخطأ الذي دفع لكتابة هذا: "0 مستنداً/شهر" رقم صحيح وبلا معنى
  it("لا تذكر المستندات إطلاقاً", () => {
    expect(planCapacityLabel(expert)).not.toContain("مستند");
    expect(planCapacityDetail(expert)).not.toContain("مستند");
    expect(planCapacityLabel(expert)).not.toContain("0");
  });

  it("توضّح أنها بلا إدخال حركات", () => {
    expect(planCapacityLabel(expert)).toContain("بلا إدخال حركات");
    expect(planCapacityDetail(expert)).toContain("بلا إدخال حركات");
  });

  it("تعرض نقاطها في التفصيل", () => {
    expect(planCapacityDetail(expert)).toContain("1000");
  });
});

describe("باقات المحاسبة", () => {
  it("تعرض حدّ المستندات كما كانت", () => {
    expect(planCapacityLabel(accounting)).toBe("50 مستنداً / شهر");
    expect(planCapacityDetail(accounting)).toContain("50 مستنداً");
    expect(planCapacityDetail(accounting)).toContain("250 نقطة");
  });

  it("تتحمّل غياب القيم بالقيم الافتراضية السابقة", () => {
    expect(planCapacityLabel({})).toBe("30 مستنداً / شهر");
    expect(planCapacityDetail({})).toContain("150 نقطة");
  });

  it("باقة بلا mode تُعامل كباقة محاسبة", () => {
    expect(isExpertPlan({ maxDocuments: 30 })).toBe(false);
    expect(planCapacityLabel({ mode: null, maxDocuments: 30 })).toContain("مستنداً");
  });
});
