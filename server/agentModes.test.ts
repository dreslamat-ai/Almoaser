import { describe, it, expect } from "vitest";
import {
  toolsForMode, modeRulesFor, identityLineFor,
  EXPERT_BLOCKED_TOOLS, GOVERNANCE_RULES, EXPERT_RULES,
} from "./agentModes";

const tool = (name: string) => ({ type: "function" as const, function: { name } });
const ALL = [
  "get_invoices", "get_invoice_detail", "get_customers", "get_items", "get_accounts",
  "get_suppliers", "get_payments", "get_journal_entries", "get_purchase_invoices",
  "get_sales_report", "get_settings", "check_tax_setup", "print_document",
  "update_settings", "setup_tax_settings",
  "create_invoice", "submit_invoice", "create_purchase_invoice", "create_payment_entry",
  "create_journal_entry", "submit_document", "update_document", "cancel_document",
  "delete_document", "create_customer", "create_supplier", "create_item",
].map(tool);

describe("toolsForMode — وضع الخبير", () => {
  it("لا يمسّ وضع المحاسبة", () => {
    expect(toolsForMode(ALL, "accounting")).toBe(ALL);
  });

  // جوهر الباقة: تقييم وضبط، بلا أي إدخال حركات
  it("يحجب كل الحركات المحاسبية", () => {
    const names = toolsForMode(ALL, "expert").map(t => t.function.name);
    for (const blocked of [
      "create_invoice", "submit_invoice", "create_purchase_invoice",
      "create_payment_entry", "create_journal_entry", "submit_document",
    ]) expect(names).not.toContain(blocked);
  });

  it("يحجب تغيير أو حذف المستندات القائمة", () => {
    const names = toolsForMode(ALL, "expert").map(t => t.function.name);
    for (const b of ["update_document", "cancel_document", "delete_document"]) {
      expect(names).not.toContain(b);
    }
  });

  it("يحجب إنشاء البيانات الأساسية — التقييم لا يستلزم سجلات جديدة", () => {
    const names = toolsForMode(ALL, "expert").map(t => t.function.name);
    for (const b of ["create_customer", "create_supplier", "create_item"]) {
      expect(names).not.toContain(b);
    }
  });

  it("يُبقي كل أدوات القراءة", () => {
    const names = toolsForMode(ALL, "expert").map(t => t.function.name);
    for (const keep of [
      "get_invoices", "get_invoice_detail", "get_customers", "get_items", "get_accounts",
      "get_suppliers", "get_payments", "get_journal_entries", "get_purchase_invoices",
      "get_sales_report", "check_tax_setup", "print_document",
    ]) expect(names).toContain(keep);
  });

  it("يُبقي ضبط الإعدادات — وهو جوهر الباقة", () => {
    const names = toolsForMode(ALL, "expert").map(t => t.function.name);
    expect(names).toContain("get_settings");
    expect(names).toContain("update_settings");
    expect(names).toContain("setup_tax_settings");
  });

  it("لا يمرّ شيء من قائمة المحجوب", () => {
    for (const t of toolsForMode(ALL, "expert")) {
      expect(EXPERT_BLOCKED_TOOLS.has(t.function.name)).toBe(false);
    }
  });

  // create_workflow يبدأ بـ create_ لكنه إعداد لا حركة محاسبية — وهو جوهر
  // باقة الخبير. لا يُضاف للمحجوب بحجة البادئة.
  it("يُبقي أدوات دورات العمل — بما فيها إنشاؤها", () => {
    const withWf = [...ALL, tool("get_workflow_options"), tool("get_workflows"), tool("create_workflow")];
    const names = toolsForMode(withWf, "expert").map(t => t.function.name);
    expect(names).toContain("get_workflow_options");
    expect(names).toContain("get_workflows");
    expect(names).toContain("create_workflow");
  });

  // أدوات البناء تبدأ بـ create_ لكنها إعداد وتخصيص لا حركة محاسبية — وهي
  // جوهر ما تبيعه باقة الخبير. لا تُحجب بحجة البادئة.
  it("يُبقي أدوات التخصيص: الحقول ونماذج الطباعة", () => {
    const withBuild = [...ALL, tool("create_custom_field"), tool("create_print_format")];
    const names = toolsForMode(withBuild, "expert").map(t => t.function.name);
    expect(names).toContain("create_custom_field");
    expect(names).toContain("create_print_format");
  });

  it("يبقى للخبير عدد معتبر من الأدوات", () => {
    const kept = toolsForMode(ALL, "expert");
    expect(kept.length).toBeGreaterThan(10);
    expect(kept.length).toBeLessThan(ALL.length);
  });
});

describe("الحوكمة", () => {
  it("تسري على الوضعين", () => {
    expect(modeRulesFor("accounting")).toContain(GOVERNANCE_RULES);
    expect(modeRulesFor("expert")).toContain(GOVERNANCE_RULES);
  });

  it("قواعد الخبير تُضاف لوضعه وحده", () => {
    expect(modeRulesFor("expert")).toContain(EXPERT_RULES);
    expect(modeRulesFor("accounting")).not.toContain(EXPERT_RULES);
  });

  it("تنصّ على منع ادّعاء النجاح ونقل الأرقام حرفياً", () => {
    expect(GOVERNANCE_RULES).toContain("لا تعلن نجاح عملية");
    expect(GOVERNANCE_RULES).toContain("حرفياً");
    expect(GOVERNANCE_RULES).toContain("لم أفحص");
  });

  it("تمنع ادّعاء تحقق خارجي — درس ZATCA", () => {
    expect(GOVERNANCE_RULES).toContain("تحققاً خارجياً");
  });

  it("تقرير الخبير مسوّدة لا شهادة", () => {
    expect(EXPERT_RULES).toContain("مسوّدة لمراجعة بشرية");
    expect(EXPERT_RULES).toContain("لم يُفحص");
  });
});

describe("identityLineFor", () => {
  it("الخبير مستشار تطبيق لا محاسب", () => {
    const s = identityLineFor("expert", false);
    expect(s).toContain("مستشار تطبيق");
    expect(s).toContain("Odoo");
    expect(s).toContain("Workflows");
  });

  it("وضع المحاسبة يحتفظ بتمييز الباقة المؤسسية", () => {
    expect(identityLineFor("accounting", true)).toContain("CFO");
    expect(identityLineFor("accounting", false)).not.toContain("CFO");
  });

  it("شخصية الخبير لا تتأثر بمهارة المدير المالي", () => {
    expect(identityLineFor("expert", true)).toBe(identityLineFor("expert", false));
  });
});
