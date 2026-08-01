import { describe, it, expect } from "vitest";
import { extractSignupAction, isUsableSalesReply, hasArabic } from "./salesAgent";

describe("extractSignupAction", () => {
  it("يفصل العلامة ويعيد رقم الباقة", () => {
    const r = extractSignupAction("الاحترافية تناسبك.\n[[SIGNUP:2]]");
    expect(r.planId).toBe(2);
    expect(r.text).toBe("الاحترافية تناسبك.");
    expect(r.text).not.toContain("SIGNUP");
  });

  it("يتحمّل مسافات داخل العلامة", () => {
    expect(extractSignupAction("نص [[ SIGNUP : 3 ]]").planId).toBe(3);
  });

  // العيب الذي دفع لهذا: الموديل كتب رابطاً مشوّهاً غير قابل للضغط
  it("ينظّف الرابط الخام المشوّه ويستخرج منه الباقة", () => {
    const r = extractSignupAction("روح على الرابط ده وسجّلي:\n\n**signup?plan=1/**\n\nلو عندك سؤال أنا موجودة.");
    expect(r.planId).toBe(1);
    expect(r.text).not.toContain("signup");
    expect(r.text).not.toContain("**");
    expect(r.text).toContain("لو عندك سؤال");
  });

  it("يزيل ذكر signup المجرّد بلا رقم", () => {
    const r = extractSignupAction("سجّل من /signup وابدأ.");
    expect(r.text).not.toContain("signup");
    expect(r.planId).toBeNull();
  });

  it("العلامة تسبق الرابط الخام عند وجودهما", () => {
    expect(extractSignupAction("x [[SIGNUP:3]] y signup?plan=1").planId).toBe(3);
  });

  it("لا يغيّر رداً عادياً", () => {
    const t = "أهلاً بك، كيف أقدر أساعدك؟";
    expect(extractSignupAction(t)).toEqual({ text: t, planId: null });
  });

  it("يرفض رقم باقة صفرياً أو سالباً", () => {
    expect(extractSignupAction("x [[SIGNUP:0]]").planId).toBeNull();
  });

  it("لا يترك أسطراً فارغة متراكمة بعد الحذف", () => {
    const r = extractSignupAction("سطر\n\n\n[[SIGNUP:2]]\n\n\nسطر آخر");
    expect(r.text).not.toMatch(/\n{3,}/);
  });
});

describe("isUsableSalesReply", () => {
  it("يرفض الفارغ", () => {
    expect(isUsableSalesReply("", true)).toBe(false);
    expect(isUsableSalesReply("  ", true)).toBe(false);
  });

  // تسريب تفكير الموديل بالإنجليزية رداً على سؤال عربي — لوحظ فعلاً
  it("يرفض رداً لاتينياً على سؤال عربي", () => {
    expect(isUsableSalesReply("The user wants to know about pricing plans.", true)).toBe(false);
  });

  it("يقبل رداً عربياً", () => {
    expect(isUsableSalesReply("أهلاً بك، الباقة الاحترافية تناسبك", true)).toBe(true);
  });

  it("يقبل الإنجليزية إن كتب العميل بالإنجليزية", () => {
    expect(isUsableSalesReply("The Professional plan suits you.", false)).toBe(true);
  });

  it("يقبل العربية المخلوطة بمصطلحات إنجليزية", () => {
    expect(isUsableSalesReply("باقة ERPNext مع Odoo تناسب نشاطك تماماً وتشمل الفوترة", true)).toBe(true);
  });
});

describe("hasArabic", () => {
  it("يميّز العربية", () => {
    expect(hasArabic("مرحبا")).toBe(true);
    expect(hasArabic("hello")).toBe(false);
    expect(hasArabic("hello مرحبا")).toBe(true);
  });
});
