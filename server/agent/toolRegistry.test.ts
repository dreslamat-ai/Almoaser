import { describe, it, expect } from "vitest";
import { TOOLS } from "./toolDefinitions";

// شبكة أمان للتفكيك: خمس وثلاثون أداة ولا اختبار يستدعي المنفّذ، فالمترجم وحده
// هو الحارس — وهو لا يلاحظ أداةً سقطت من التسجيل. هذا الاختبار يلاحظ.
// إضافة أداة تتطلب تحديث القائمة عمداً؛ اختفاء أداة يكسر البناء فوراً.
const EXPECTED = [
  "cancel_document",
  "check_tax_setup",
  "create_custom_field",
  "create_customer",
  "create_invoice",
  "create_item",
  "create_journal_entry",
  "create_payment_entry",
  "create_print_format",
  "create_purchase_invoice",
  "create_supplier",
  "create_workflow",
  "delete_document",
  "delete_with_dependencies",
  "get_accounts",
  "get_customers",
  "get_invoice_detail",
  "get_invoices",
  "get_items",
  "get_journal_entries",
  "get_payments",
  "get_purchase_invoices",
  "get_sales_report",
  "get_settings",
  "get_suppliers",
  "get_workflow_options",
  "get_workflows",
  "list_documents",
  "print_document",
  "request_custom_app",
  "save_report",
  "setup_tax_settings",
  "submit_document",
  "submit_invoice",
  "update_customer",
  "update_document",
  "update_settings"
] as const;

describe("تسجيل أدوات الوكيل", () => {
  it("الأدوات المسجّلة هي نفسها بالضبط", () => {
    const actual = TOOLS.map(t => t.function.name).sort();
    expect(actual).toEqual([...EXPECTED]);
  });

  it("لا اسم مكرر", () => {
    const names = TOOLS.map(t => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("لكل أداة وصف ومخطط معاملات", () => {
    for (const t of TOOLS) {
      expect(t.function.description, t.function.name).toBeTruthy();
      expect(t.function.parameters, t.function.name).toBeTruthy();
    }
  });
});
