import { describe, it, expect } from "vitest";
import { extractSignupAction, isUsableSalesReply, hasArabic, buildSalesSystemPrompt, SALES_MODELS } from "./salesAgent";

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

// تسريب حقيقي شوهد في الإنتاج: "المستند الذي 记录的 البيع"
describe("رفض تسريب اللغة الثالثة", () => {
  it("يرفض حروفاً صينية داخل رد عربي سليم في الباقي", () => {
    expect(isUsableSalesReply("الفاتورة هي المستند الذي 记录的 البيع في النظام", true)).toBe(false);
  });

  it("يرفضها في الرد الإنجليزي أيضاً — العيب ليس في لغة السائل", () => {
    expect(isUsableSalesReply("The invoice is the document that 记录 the sale", false)).toBe(false);
  });

  it("يرفض اليابانية والكورية كذلك", () => {
    expect(isUsableSalesReply("الفاتورة テスト في النظام", true)).toBe(false);
    expect(isUsableSalesReply("الفاتورة 테스트 في النظام", true)).toBe(false);
  });

  // الرد السليم لا يُرفض: المصطلحات الإنجليزية مشروعة في سياقنا
  it("يقبل رداً عربياً فيه مصطلحات إنجليزية", () => {
    expect(isUsableSalesReply("نعم، ERPNext يدعم Sales Invoice بشكل كامل", true)).toBe(true);
  });
});

describe("نطاق سارة في رسالة النظام", () => {
  const prompt = buildSalesSystemPrompt([
    { id: 1, nameAr: "الأساسية", price: 499, monthlyCredits: 300 } as never,
  ]);

  it("يسمّي ما خرج عن النطاق لا فئات مجرّدة", () => {
    for (const t of ["النكت", "الطبخ", "الطب", "الرياضة"]) expect(prompt).toContain(t);
  });

  // نفس الالتفاف الذي استخدمه المحاسب الذكي فعلاً
  it("يمنع إسقاط السؤال الخارجي على المحاسبة", () => {
    expect(prompt).toContain("ولا تُسقطي السؤال على المحاسبة");
  });

  it("يمنع ذكر المنافسين بالاسم", () => {
    expect(prompt).toContain("لا تتحدثي عن منافسين بالاسم");
  });

  it("يمنع اختراع معلومة عن ERPNext لإكمال الإجابة", () => {
    expect(prompt).toContain("لا تخترعي معلومة عن ERPNext");
  });

  it("يمنع لغة ثالثة مع بقاء قاعدة مجاراة لهجة العميل", () => {
    expect(prompt).toContain("لا تُدخلي حرفاً من لغة ثالثة");
    expect(prompt).toContain("تحدّثي بلغة العميل ولهجته");
  });
});

describe("سلسلة موديلات المبيعات", () => {
  // أجاب "٣٥٠٠ ريال" عن سعر الباقة الاحترافية (٩٩٩) — سعر باقة الخبير
  it("لا تعود بموديل أخطأ في نقل الأسعار", () => {
    expect(SALES_MODELS).not.toContain("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("يبقى أكثر من مصدر: تعطّل واحد لا يُسكت سارة", () => {
    expect(SALES_MODELS.length).toBeGreaterThanOrEqual(3);
  });
});
