import { describe, it, expect } from "vitest";
import { TOOL_PERMISSIONS } from "./agent/toolPermissions";
import {
  toolsForMode, modeRulesFor, identityLineFor,
  EXPERT_BLOCKED_TOOLS, GOVERNANCE_RULES, EXPERT_RULES, SCOPE_RULES, SYSTEM_REACH_RULES,
  resolveCapabilities, toolsForSubscriptions,
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

describe("resolveCapabilities — اشتراكان متوازيان", () => {
  it("محاسبي وحده: بلا حجب", () => {
    const r = resolveCapabilities({ hasAccounting: true, hasExpert: false });
    expect(r.blockTransactions).toBe(false);
    expect(r.mode).toBe("accounting");
  });

  it("خبير وحده: يُحجب إدخال الحركات", () => {
    const r = resolveCapabilities({ hasAccounting: false, hasExpert: true });
    expect(r.blockTransactions).toBe(true);
    expect(r.mode).toBe("expert");
  });

  // جوهر الاشتراك المتوازي: من دفع ثمن الاثنين يأخذهما معاً
  it("الاثنان معاً: لا يُحجب شيء", () => {
    const r = resolveCapabilities({ hasAccounting: true, hasExpert: true });
    expect(r.blockTransactions).toBe(false);
  });

  it("من يحمل الاثنين يحتفظ بأدوات الحركات وبأدوات الخبير", () => {
    const all = [...ALL, tool("create_workflow"), tool("create_print_format")];
    const names = toolsForSubscriptions(all, { hasAccounting: true, hasExpert: true }).map(t => t.function.name);
    expect(names).toContain("create_invoice");
    expect(names).toContain("create_journal_entry");
    expect(names).toContain("create_workflow");
    expect(names).toContain("create_print_format");
  });

  it("الخبير وحده لا يرى أدوات الحركات لكنه يرى أدواته", () => {
    const all = [...ALL, tool("create_workflow")];
    const names = toolsForSubscriptions(all, { hasAccounting: false, hasExpert: true }).map(t => t.function.name);
    expect(names).not.toContain("create_invoice");
    expect(names).not.toContain("create_journal_entry");
    expect(names).toContain("create_workflow");
    expect(names).toContain("get_invoices");
  });

  it("بلا اشتراك أصلاً: يُعامل كمحاسبي فلا يُحرم أحد بسبب تعذّر القراءة", () => {
    expect(resolveCapabilities({ hasAccounting: false, hasExpert: false }).blockTransactions).toBe(false);
  });
});

// حادثتان حقيقيتان: شرح "المكرونة بالصلصة" كصنف، وروى نكتة حين طُلبت
describe("SCOPE_RULES — حدّ الموضوع واللغة", () => {
  it("يسري على وضع المحاسبة ووضع الخبير معاً", () => {
    expect(modeRulesFor("accounting")).toContain(SCOPE_RULES);
    expect(modeRulesFor("expert")).toContain(SCOPE_RULES);
  });

  it("يسمّي ما خرج عن النطاق فعلاً لا فئات مجرّدة", () => {
    for (const t of ["النكت", "الطبخ", "الطب", "الرياضة"]) expect(SCOPE_RULES).toContain(t);
  });

  // المزلق الذي وقع فيه: أسقط سؤال الطعام على "صنف في النظام" ليبرّر الإجابة
  it("يمنع إسقاط سؤال خارجي على المحاسبة كحيلة للإجابة", () => {
    expect(SCOPE_RULES).toContain("ولا تُسقِط السؤال على المحاسبة");
  });

  // القاعدتان تبدوان متناقضتين للموديل ما لم يُفصل بينهما صراحةً
  it("يفصل رفض الموضوع عن قاعدة عدم الرفض الاستباقي للأدوات", () => {
    expect(SCOPE_RULES).toContain("الصلاحيات والأدوات");
  });

  it("يمنع تسرّب لغة ثالثة داخل النص العربي", () => {
    expect(SCOPE_RULES).toContain("لا تُدخل أي حرف من لغة ثالثة");
  });

  // الحوكمة قائمة بذاتها: النطاق يُضاف إليها ولا يزيحها
  it("لا يزيح قواعد الحوكمة", () => {
    expect(modeRulesFor("accounting")).toContain(GOVERNANCE_RULES);
  });
});

// شوهد فعلاً: قال "تفضل الأزرار الجاهزة" ولم يصدر السطر، فبحث المستخدم عن أزرار لا وجود لها
describe("تعليمات الأزرار السريعة", () => {
  it("تمنع الحديث عن أزرار بدل إصدارها", async () => {
    const src = await import("fs").then(fs => fs.readFileSync("server/routers/agent.ts", "utf8"));
    expect(src).toContain("لا تتحدث عن الأزرار ولا تعد بها");
    expect(src).toContain("بعد عرض قائمة بما تستطيع فعله");
  });
});

// قيل لعميل إن حذف إشعار التسليم غير مدعوم وهو مدعوم — القائمة المغلقة كانت
// في تعريف الأداة، فاعتذر الوكيل بصدق عن قيد صنعناه نحن
describe("SYSTEM_REACH_RULES — مدى الأدوات في نظام العميل", () => {
  it("ينصّ على أن الأدوات تعمل على أي DocType", () => {
    expect(SYSTEM_REACH_RULES).toContain("أي DocType");
    expect(SYSTEM_REACH_RULES).toContain("إشعارات التسليم");
  });

  it("يمنع الاعتذار قبل المحاولة", () => {
    expect(SYSTEM_REACH_RULES).toContain("لا تعتذر بعدم امتلاك أداة قبل أن تجرّب");
  });

  it("يصف الترتيب الصحيح عند فشل الحذف بسبب ارتباط", () => {
    expect(SYSTEM_REACH_RULES).toContain("list_documents");
  });

  it("يجعل الحدّ صلاحيات نظام العميل لا قائمة أدواتنا", () => {
    expect(SYSTEM_REACH_RULES).toContain("صلاحياتك في نظامه");
  });

  it("يسري على الوضعين", () => {
    expect(modeRulesFor("accounting")).toContain(SYSTEM_REACH_RULES);
    expect(modeRulesFor("expert")).toContain(SYSTEM_REACH_RULES);
  });
});

// النظام يعمل بمستخدم System Manager ومع ذلك رُفض الحذف — والسبب تكامل مرجعي
// لا صلاحيات: إشعار تسليم بحالة docstatus=2 (ملغى) ما زال يمسك الرابط
describe("قواعد الحذف والتكامل المرجعي", () => {
  it("تفصل LinkExistsError عن رفض الصلاحية", () => {
    expect(SYSTEM_REACH_RULES).toContain("LinkExistsError ليس رفض صلاحية");
  });

  it("تنصّ على أن الملغى ما زال يمسك الرابط", () => {
    expect(SYSTEM_REACH_RULES).toContain("docstatus=2");
    expect(SYSTEM_REACH_RULES).toContain("الإلغاء وحده لا يفكّ الارتباط");
  });

  it("تحدّد ترتيب الحذف من المرتبط إلى الأصل", () => {
    expect(SYSTEM_REACH_RULES).toContain("إشعارات التسليم ← أوامر البيع");
  });

  // قيل "لا توجد مستندات مرتبطة" وكان هناك واحد — الفحص قبل الوعد
  it("تلزم بالفحص قبل الوعد بحذف مباشر", () => {
    expect(SYSTEM_REACH_RULES).toContain("افحص قبل أن تَعِد");
    expect(SYSTEM_REACH_RULES).toContain("بلا ترشيح على الحالة");
  });
});

describe("فريق الأقسام وحدود الباقات", () => {
  const review = { function: { name: "department_review" } };

  // القراءة والتقييم صميمُ عمل الخبير، فمراجعة الدفاتر ليست تجاوزاً لباقته.
  // والمحاسب يقرأ تقاريره أصلاً. فالأداة تخدم الاثنتين ولا توسّع أيّهما.
  it("متاحة في وضع المحاسب والخبير معاً", () => {
    expect(toolsForMode([review], "accounting")).toHaveLength(1);
    expect(toolsForMode([review], "expert")).toHaveLength(1);
  });

  it("متاحة لمن اشترك في الخبير وحده — لا حركة محاسبية فيها", () => {
    const only = toolsForSubscriptions([review], { hasAccounting: false, hasExpert: true });
    expect(only).toHaveLength(1);
  });

  it("ليست ضمن ما يُحجب عن الخبير", () => {
    expect(EXPERT_BLOCKED_TOOLS.has("department_review")).toBe(false);
  });

  // لو صارت يوماً تكتب، وجب حجبها عن الخبير. هذا الاختبار يربط الأمرين
  // فلا يُغيَّر أحدهما وحده بسهو.
  it("كل أداة محجوبة عن الخبير هي أداة كتابة", () => {
    for (const name of EXPERT_BLOCKED_TOOLS) {
      expect(/^(create|update|delete|cancel|submit|setup)_/.test(name)).toBe(true);
    }
  });

  it("تتبع صلاحية قراءة الفواتير كبقية التقارير", () => {
    expect(TOOL_PERMISSIONS.department_review).toBe("viewInvoices");
    expect(TOOL_PERMISSIONS.department_review).toBe(TOOL_PERMISSIONS.get_sales_report);
  });

  it("الحوكمة تنصّ على أن القسم يُبلِّغ ولا يعدّل", () => {
    expect(GOVERNANCE_RULES).toContain("department_review");
    expect(GOVERNANCE_RULES).toContain("ولا تُصلح شيئاً منها");
  });
});
