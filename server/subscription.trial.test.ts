import { describe, it, expect } from "vitest";
import { trialDaysLeft } from "../shared/subscription";

describe("trialDaysLeft — حساب الأيام المتبقية للتجربة", () => {
  const now = new Date("2026-07-17T12:00:00Z");

  it("يرجع 3 أيام عند بداية تجربة 3 أيام", () => {
    const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    expect(trialDaysLeft(end, now)).toBe(3);
  });

  it("يقرّب لأعلى: ساعة متبقية = يوم واحد", () => {
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    expect(trialDaysLeft(end, now)).toBe(1);
  });

  it("يرجع 0 بعد انتهاء التجربة", () => {
    const end = new Date(now.getTime() - 1000);
    expect(trialDaysLeft(end, now)).toBe(0);
  });

  it("يرجع 0 عند غياب تاريخ النهاية", () => {
    expect(trialDaysLeft(null, now)).toBe(0);
    expect(trialDaysLeft(undefined, now)).toBe(0);
  });

  it("يقبل التاريخ كنص ISO", () => {
    const end = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(trialDaysLeft(end, now)).toBe(2);
  });
});

