import { describe, it, expect } from "vitest";
import { frappeHumanMessage, translateErpError } from "./erpHelpers";

// نصوص وصلت فعلاً للعميل في تيليجرام كما هي — بأغلفتها الثلاثة
const LINK_EXISTS = String.raw`ERPNext DELETE error 417: {"exc_type":"LinkExistsError","exception":"frappe.exceptions.LinkExistsError: لا يمكن حذف أو إلغاء لأن إذن تسليم <a href=\"/app/Form/Delivery Note/MAT-DN-2024-00001\">MAT-DN-2024-00001</a> مرتبط"}`;
const PERMISSION = String.raw`ERPNext GET error 417: {"exc_type":"DataError","exception":"frappe.exceptions.DataError: Field not permitted in query: party"}`;

describe("frappeHumanMessage", () => {
  it("يفكّ الترميز ويزيل الوسوم ويُبقي اسم المستند المانع", () => {
    const m = frappeHumanMessage(LINK_EXISTS);
    expect(m).toContain("لا يمكن حذف");
    expect(m).toContain("MAT-DN-2024-00001");
    expect(m).not.toContain("\\u06");
    expect(m).not.toContain("<a href");
    expect(m).not.toContain("frappe.exceptions");
  });

  it("يقرأ _server_messages المغلّف مرتين", () => {
    const raw = JSON.stringify({
      _server_messages: JSON.stringify([JSON.stringify({ message: "فاتورة مبيعات MAT-DN غير موجودة" })]),
    });
    expect(frappeHumanMessage(raw)).toBe("فاتورة مبيعات MAT-DN غير موجودة");
  });

  it("يعيد فراغاً لا يرمي حين لا رسالة", () => {
    expect(frappeHumanMessage("خطأ نصّي عادي")).toBe("");
  });
});

describe("translateErpError — لا شيفرة خام للعميل", () => {
  it("الارتباط يُشرح ويُذكر معه ما يفعله المستخدم", () => {
    const t = translateErpError(LINK_EXISTS);
    expect(t).toContain("MAT-DN-2024-00001");
    expect(t).toContain("ألغه أولاً");
    expect(t).not.toContain("exc_type");
    expect(t).not.toContain("{");
  });

  it("لا يسلّم JSON خاماً مهما كان الخطأ", () => {
    const t = translateErpError(PERMISSION);
    expect(t).not.toContain('"exc_type"');
    expect(t.trim().startsWith("{")).toBe(false);
  });

  it("يبقي رسالة نصّية عادية كما هي", () => {
    expect(translateErpError("تعذّر الاتصال بالخادم")).toBe("تعذّر الاتصال بالخادم");
  });
});

// وقع فعلاً: قيل لمن يملك System Manager إن صلاحياته ناقصة، والسبب أن نص
// Frappe يحوي "not permitted" وهو عن حقول الاستعلام لا عن الصلاحيات
describe("لا تُنسب أخطاء الاستعلام للصلاحيات", () => {
  const FIELD = String.raw`ERPNext GET error 417: {"exc_type":"DataError","exception":"frappe.exceptions.DataError: Field not permitted in query: delivery_note"}`;

  it("يسمّي الحقل ويقول صراحةً إنها ليست صلاحيات", () => {
    const t = translateErpError(FIELD);
    expect(t).toContain("delivery_note");
    expect(t).toContain("ليست مشكلة صلاحيات");
    expect(t).not.toContain("صلاحيات غير كافية");
  });

  it("يبقي رفض الصلاحية الحقيقي كما هو", () => {
    const real = String.raw`{"exc_type":"PermissionError","exception":"frappe.exceptions.PermissionError: لا تملك صلاحية"}`;
    expect(translateErpError(real)).toContain("صلاحيات غير كافية");
  });

  it("الإلغاء على مستند ملغى يُشرح ويوجّه للحذف", () => {
    const t = translateErpError(String.raw`{"exc_type":"ValidationError","exception":"frappe.exceptions.ValidationError: Cannot cancel a cancelled document"}`);
    expect(t).toContain("ملغى بالفعل");
    expect(t).toContain("حذفه");
  });
});

// السبب الحقيقي وراء فشل إلغاء إشعار تسليم 2023 — قيد محاسبي لا عطل
describe("إقفال الفترة", () => {
  const CLOSED = String.raw`ERPNext POST error 417: {"exc_type":"ValidationError","exception":"frappe.exceptions.ValidationError: Due to period closing, you cannot repost item valuation before 2023-12-31"}`;

  it("يشرحه كقيد محاسبي ويذكر التاريخ", () => {
    const t = translateErpError(CLOSED);
    expect(t).toContain("الفترة المحاسبية مقفلة");
    expect(t).toContain("2023-12-31");
    expect(t).toContain("ليس خطأً في النظام");
  });

  it("يوجّه للقرار الصحيح لا لإعادة المحاولة", () => {
    expect(translateErpError(CLOSED)).toContain("قيد إقفال الفترة");
  });
});
