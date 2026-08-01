import { describe, it, expect } from "vitest";
import { computeCapabilities, erpAllowsTool, cacheKey, type DocPermRow } from "./erpPermissions";

// لقطة من رد DocPerm حقيقي على demo.almoaser.cloud — بما فيه صفوف permlevel=1
const ROWS: DocPermRow[] = [
  { parent: "Sales Invoice", role: "Accounts User", permlevel: 0, read: 1, create: 1, write: 1, submit: 1, delete: 1 },
  { parent: "Sales Invoice", role: "Accounts Manager", permlevel: 0, read: 1, create: 1, write: 1, submit: 1, delete: 1 },
  { parent: "Sales Invoice", role: "Accounts Manager", permlevel: 1, read: 1, create: 1, write: 1, submit: 1, delete: 1 },
  { parent: "Sales Invoice", role: "Auditor", permlevel: 0, read: 0, create: 0, write: 0, submit: 0, delete: 0 },
  { parent: "Journal Entry", role: "Accounts User", permlevel: 0, read: 1, create: 1, write: 1, submit: 1, delete: 1 },
  { parent: "Journal Entry", role: "Auditor", permlevel: 0, read: 1, create: 0, write: 0, submit: 0, delete: 0 },
  { parent: "Payment Entry", role: "Accounts User", permlevel: 0, read: 1, create: 1, write: 1, submit: 1, delete: 1 },
  { parent: "Customer", role: "Sales User", permlevel: 0, read: 1, create: 1, write: 1, submit: 0, delete: 0 },
  { parent: "Customer", role: "Accounts User", permlevel: 0, read: 1, create: 0, write: 0, submit: 0, delete: 0 },
];

describe("computeCapabilities", () => {
  // الفخ الذي كان سيصيب كل مستخدمي المنصة: System Manager بلا صفوف DocPerm أصلاً
  it("System Manager غير مقيَّد رغم أنه بلا صفوف في الجدول", () => {
    const caps = computeCapabilities(["System Manager"], ROWS);
    expect(caps.unrestricted).toBe(true);
    expect(caps.can("Journal Entry", "create")).toBe(true);
    expect(caps.can("أي شيء", "delete")).toBe(true);
  });

  it("Administrator كذلك", () => {
    expect(computeCapabilities(["Administrator"], []).unrestricted).toBe(true);
  });

  it("Auditor يقرأ قيود اليومية ولا ينشئها", () => {
    const caps = computeCapabilities(["Auditor"], ROWS);
    expect(caps.unrestricted).toBe(false);
    expect(caps.can("Journal Entry", "read")).toBe(true);
    expect(caps.can("Journal Entry", "create")).toBe(false);
    expect(caps.can("Sales Invoice", "read")).toBe(false);
  });

  it("Sales User ينشئ عملاء ولا يرى الفواتير", () => {
    const caps = computeCapabilities(["Sales User"], ROWS);
    expect(caps.can("Customer", "create")).toBe(true);
    expect(caps.can("Sales Invoice", "read")).toBe(false);
  });

  it("الأدوار تتجمّع: أي دور يمنح الإجراء يكفي", () => {
    const caps = computeCapabilities(["Auditor", "Sales User"], ROWS);
    expect(caps.can("Journal Entry", "read")).toBe(true);   // من Auditor
    expect(caps.can("Customer", "create")).toBe(true);      // من Sales User
    expect(caps.can("Payment Entry", "create")).toBe(false); // من لا أحد
  });

  // permlevel>0 صلاحية حقول لا مستندات
  it("يتجاهل صفوف permlevel غير الصفري", () => {
    const onlyFieldLevel: DocPermRow[] = [
      { parent: "Sales Invoice", role: "X", permlevel: 1, read: 1, create: 1, write: 1 },
    ];
    const caps = computeCapabilities(["X"], onlyFieldLevel);
    expect(caps.can("Sales Invoice", "create")).toBe(false);
    expect(caps.can("Sales Invoice", "read")).toBe(false);
  });

  it("بلا أدوار مطابقة لا شيء مسموح", () => {
    const caps = computeCapabilities(["دور غير موجود"], ROWS);
    expect(caps.can("Sales Invoice", "read")).toBe(false);
  });
});

describe("erpAllowsTool", () => {
  it("غير المقيَّد يمرّ له كل شيء", () => {
    const caps = computeCapabilities(["System Manager"], ROWS);
    for (const t of ["create_journal_entry", "get_invoices", "update_settings"]) {
      expect(erpAllowsTool(caps, t)).toBe(true);
    }
  });

  it("يترجم الأداة إلى دوكتايب وإجراء", () => {
    const caps = computeCapabilities(["Auditor"], ROWS);
    expect(erpAllowsTool(caps, "get_journal_entries")).toBe(true);
    expect(erpAllowsTool(caps, "create_journal_entry")).toBe(false);
    expect(erpAllowsTool(caps, "get_invoices")).toBe(false);
  });

  it("أداة بلا دوكتايب مقابل لا تُقيَّد هنا", () => {
    const caps = computeCapabilities(["Auditor"], ROWS);
    expect(erpAllowsTool(caps, "get_settings")).toBe(true);
    expect(erpAllowsTool(caps, "print_document")).toBe(true);
  });
});

describe("cacheKey", () => {
  // نسختان لنفس الرابط بمستخدمين مختلفين — موجود فعلاً في قاعدة الإنتاج
  it("يفرّق بين مستخدمين على نفس النسخة", () => {
    expect(cacheKey("https://erp.x.cloud", "admin"))
      .not.toBe(cacheKey("https://erp.x.cloud", "other@x.com"));
  });

  it("لا يتأثر بالشرطة المائلة الأخيرة", () => {
    expect(cacheKey("https://erp.x.cloud/", "a")).toBe(cacheKey("https://erp.x.cloud", "a"));
  });
});
