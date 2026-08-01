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
