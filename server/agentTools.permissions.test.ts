import { describe, it, expect } from "vitest";
import { canUseTool, toolsForUser } from "./routers/agent";

type U = { orgRole: "owner" | "member" | null; permissions: string | null };
const owner: U = { orgRole: "owner", permissions: null };
// الصلاحيات المخزَّنة تُدمج فوق DEFAULT_MEMBER_PERMISSIONS (وفيها viewInvoices
// وcreateInvoices = true)، فالمنع يحتاج false صريحاً لا مجرد إغفال المفتاح.
const member = (perms: Record<string, boolean>): U => ({ orgRole: "member", permissions: JSON.stringify(perms) });
const readOnlyMember = () => member({ viewInvoices: true, createInvoices: false });

const tool = (name: string) => ({ type: "function" as const, function: { name } });
const ALL = [
  "get_invoices", "get_customers", "get_items", "get_accounts", "get_suppliers",
  "create_invoice", "create_payment_entry", "create_journal_entry",
  "update_settings", "delete_document", "print_document",
].map(tool);

describe("canUseTool", () => {
  it("المالك يملك كل شيء", () => {
    for (const t of ALL) expect(canUseTool(owner, t.function.name)).toBe(true);
  });

  it("الأدوات العامة متاحة لأي عضو بلا صلاحيات", () => {
    const u = member({});
    for (const n of ["get_customers", "get_items", "get_accounts", "get_suppliers"]) {
      expect(canUseTool(u, n)).toBe(true);
    }
  });

  it("الأداة المقيَّدة محجوبة بلا صلاحيتها", () => {
    const u = readOnlyMember();
    expect(canUseTool(u, "get_invoices")).toBe(true);
    expect(canUseTool(u, "create_invoice")).toBe(false);
    expect(canUseTool(u, "create_payment_entry")).toBe(false);
    expect(canUseTool(u, "update_settings")).toBe(false);
  });

  it("كل صلاحية تفتح أدواتها هي فقط", () => {
    expect(canUseTool(member({ managePayments: true }), "create_payment_entry")).toBe(true);
    expect(canUseTool(member({ managePayments: true }), "create_journal_entry")).toBe(false);
    expect(canUseTool(member({ manageJournalEntries: true }), "create_journal_entry")).toBe(true);
    expect(canUseTool(member({ manageErpSettings: true }), "delete_document")).toBe(true);
  });
});

describe("toolsForUser", () => {
  it("لا يحجب شيئاً عن المالك", () => {
    expect(toolsForUser(ALL, owner)).toBe(ALL);
  });

  it("عضو للقراءة فقط يحصل على أدوات القراءة دون الإنشاء", () => {
    const names = toolsForUser(ALL, readOnlyMember()).map(t => t.function.name);
    expect(names).toContain("get_invoices");
    expect(names).toContain("print_document");
    expect(names).not.toContain("create_invoice");
    expect(names).not.toContain("delete_document");
  });

  it("يقلّص العدد فعلاً — وهذا هو الغرض", () => {
    const readOnly = toolsForUser(ALL, readOnlyMember());
    expect(readOnly.length).toBeLessThan(ALL.length);
    expect(readOnly.length).toBeGreaterThan(0);
  });

  // الحجب تضييق لا توسيع: ما يمر من الفلترة يجب أن يكون مسموحاً فعلاً
  it("كل أداة تمر الفلترة مسموحة لصاحبها", () => {
    for (const perms of [{}, { viewInvoices: false }, { createInvoices: false }, { managePayments: true }]) {
      const u = member(perms);
      for (const t of toolsForUser(ALL, u)) expect(canUseTool(u, t.function.name)).toBe(true);
    }
  });
});
