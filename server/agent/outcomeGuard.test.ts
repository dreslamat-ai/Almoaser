import { describe, it, expect } from "vitest";
import { outcomeOf, claimsSuccess, verifyReply, summarizeOutcomes, isMutating } from "./outcomeGuard";

describe("outcomeOf — ما يُعدّ نجاحاً", () => {
  it("النجاح يتطلّب غياب خطأ", () => {
    expect(outcomeOf("create_invoice", JSON.stringify({ name: "SINV-1" })).ok).toBe(true);
  });

  it("حقل error فشل مهما كانت حالة HTTP", () => {
    const o = outcomeOf("delete_document", JSON.stringify({ error: "مرتبط بإشعار تسليم" }));
    expect(o.ok).toBe(false);
    expect(o.error).toContain("إشعار تسليم");
  });

  // طلب التوضيح ليس تنفيذاً: العملية لم تقع بعد
  it("needs_clarification ليس نجاحاً", () => {
    expect(outcomeOf("create_payment_entry", JSON.stringify({ needs_clarification: true })).ok).toBe(false);
  });

  it("منع التكرار ليس إنشاءً", () => {
    expect(outcomeOf("create_customer", JSON.stringify({ duplicate_prevented: true })).ok).toBe(false);
  });

  it("رد غير صالح فشل لا نجاح صامت", () => {
    expect(outcomeOf("create_item", "ليس JSON").ok).toBe(false);
  });
});

describe("isMutating", () => {
  it("يميّز ما يغيّر الحالة عمّا يقرأ", () => {
    for (const t of ["create_invoice", "delete_document", "submit_document", "platform_grant_credits"]) {
      expect(isMutating(t), t).toBe(true);
    }
    for (const t of ["get_invoices", "list_documents", "platform_users"]) {
      expect(isMutating(t), t).toBe(false);
    }
  });
});

describe("verifyReply — الحادثة التي وقعت", () => {
  // "تم تنفيذ الطلب" ولم يُنفَّذ شيء
  it("يمنع إعلان النجاح بلا أي عملية", () => {
    const v = verifyReply("تم تنفيذ الطلب.", []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.replacement).toContain("لم أنفّذ أي تغيير");
  });

  it("يمنع إعلان النجاح وقد فشلت الأداة — ويكشف السبب", () => {
    const v = verifyReply("تم حذف العميل بنجاح.", [
      { name: "delete_document", ok: false, error: "مرتبط بإشعار تسليم MAT-DN-2024-00001" },
    ]);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.replacement).toContain("لم يكتمل التنفيذ");
      expect(v.replacement).toContain("MAT-DN-2024-00001");
      expect(v.replacement).toContain("لم يتغيّر شيء في نظامك");
    }
  });

  it("يسمح بإعلان النجاح حين نجحت العملية فعلاً", () => {
    expect(verifyReply("تم إنشاء الفاتورة SINV-1.", [{ name: "create_invoice", ok: true }]).ok).toBe(true);
  });

  // الردود الخبرية لا تُعترض: من سأل عن قائمة لا يُنتظر منه تنفيذ
  it("لا يعترض على رد لا يدّعي إنجازاً", () => {
    expect(verifyReply("لديك ٣ فواتير غير مدفوعة.", []).ok).toBe(true);
  });

  it("لا يحسب نجاح أداة قراءة سنداً لادّعاء تنفيذ", () => {
    expect(verifyReply("تم الحذف.", [{ name: "get_customers", ok: true }]).ok).toBe(false);
  });

  // النجاح الجزئي أخطر من الفشل الكامل: يُقرأ نجاحاً تاماً
  it("يعترض حين نجحت واحدة وفشلت أخرى", () => {
    const v = verifyReply("تم تنفيذ الطلب.", [
      { name: "create_invoice", ok: true },
      { name: "submit_document", ok: false, error: "الفاتورة ناقصة البيانات" },
    ]);
    expect(v.ok).toBe(false);
  });
});

describe("summarizeOutcomes — بديل النص الثابت", () => {
  it("لا يدّعي تنفيذاً حين لم تُستدعَ أداة", () => {
    const s = summarizeOutcomes([]);
    expect(s).not.toMatch(/تم تنفيذ|تمّت/);
    expect(s).toContain("لم أنفّذ أي عملية");
  });

  it("يذكر الفشل بسببه لا بصيغة عامة", () => {
    const s = summarizeOutcomes([{ name: "delete_document", ok: false, error: "مرتبط بأمر بيع" }]);
    expect(s).toContain("لم يكتمل");
    expect(s).toContain("مرتبط بأمر بيع");
  });

  it("يفصل ما نجح عمّا فشل بدل إعلان واحد", () => {
    const s = summarizeOutcomes([
      { name: "create_invoice", ok: true },
      { name: "submit_document", ok: false, error: "خطأ" },
    ]);
    expect(s).toContain("نجح");
    expect(s).toContain("لم ينجح");
  });
});

describe("claimsSuccess", () => {
  it("يلتقط صيغ الإنجاز الشائعة", () => {
    for (const t of ["تم تنفيذ الطلب.", "تم الحذف", "أنشأتُ الفاتورة", "اعتُمد المستند"]) {
      expect(claimsSuccess(t), t).toBe(true);
    }
  });

  it("لا يلتقط الوصف أو السؤال", () => {
    expect(claimsSuccess("هل تريد أن أحذفه؟")).toBe(false);
    expect(claimsSuccess("لديك ٥ عملاء")).toBe(false);
  });
});
