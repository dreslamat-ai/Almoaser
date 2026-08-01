import { describe, it, expect } from "vitest";
import { inspectCustomerCompleteness, describeMissing } from "./customerCompleteness";

const company = { customer_type: "Company", tax_id: "310000000000003" };
const fullAddress = { address_line1: "طريق الملك فهد", city: "الرياض", country: "Saudi Arabia", pincode: "12345" };

describe("منشأة — الفاتورة الضريبية", () => {
  it("مكتملة عند وجود الرقم الضريبي والعنوان", () => {
    const r = inspectCustomerCompleteness(company, fullAddress);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("تمنع بلا رقم ضريبي", () => {
    const r = inspectCustomerCompleteness({ customer_type: "Company", tax_id: null }, fullAddress);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("tax_id");
  });

  it("تمنع بلا عنوان إطلاقاً", () => {
    const r = inspectCustomerCompleteness(company, null);
    expect(r.complete).toBe(false);
    expect(r.missing).toContain("address");
  });

  it("تمنع عند عنوان ناقص المدينة أو الدولة", () => {
    expect(inspectCustomerCompleteness(company, { ...fullAddress, city: null }).missing).toContain("address_city");
    expect(inspectCustomerCompleteness(company, { ...fullAddress, country: "  " }).missing).toContain("address_country");
  });

  // الرمز البريدي جزء من العنوان الوطني لكنه لا يوقف الإصدار
  it("الرمز البريدي تنبيه لا مانع", () => {
    const r = inspectCustomerCompleteness(company, { ...fullAddress, pincode: null });
    expect(r.complete).toBe(true);
    expect(r.warnings).toContain("postal_code");
  });

  it("تجمع كل النواقص لا أولها فقط — حتى تُطلب مرة واحدة", () => {
    const r = inspectCustomerCompleteness({ customer_type: "Company", tax_id: "" }, null);
    expect(r.missing).toContain("tax_id");
    expect(r.missing).toContain("address");
    expect(r.missing.length).toBeGreaterThanOrEqual(2);
  });

  it("المسافات وحدها ليست قيمة", () => {
    expect(inspectCustomerCompleteness({ customer_type: "Company", tax_id: "   " }, fullAddress).missing).toContain("tax_id");
    expect(inspectCustomerCompleteness(company, { ...fullAddress, address_line1: " " }).missing).toContain("address");
  });

  it("النوع الافتراضي منشأة لا فرد", () => {
    const r = inspectCustomerCompleteness({ tax_id: null }, null);
    expect(r.isIndividual).toBe(false);
    expect(r.complete).toBe(false);
  });
});

describe("فرد — الفاتورة المبسّطة", () => {
  it("لا تستلزم رقماً ضريبياً ولا عنواناً", () => {
    const r = inspectCustomerCompleteness({ customer_type: "Individual" }, null);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.isIndividual).toBe(true);
  });
});

describe("describeMissing", () => {
  it("يكتب النواقص بالعربية للعميل", () => {
    const s = describeMissing(["tax_id", "address"]);
    expect(s).toContain("الرقم الضريبي");
    expect(s).toContain("عنوان");
  });

  it("يعيد نصاً فارغاً بلا نواقص", () => {
    expect(describeMissing([])).toBe("");
  });
});
