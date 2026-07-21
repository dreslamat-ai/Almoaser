// ─── اختبارات شخصية الوكيل: المهارات المالية الأربع ──────────────────────────
import { describe, it, expect } from "vitest";
import {
  buildExpertSkillsSection,
  EXPERT_ACCOUNTANT_SKILL,
  CFO_SKILL,
  CHIEF_ACCOUNTANT_SKILL,
  ERPNEXT_EXPERT_SKILL,
} from "./routers/agentPersona";

describe("buildExpertSkillsSection — تجميع المهارات الأربع", () => {
  const section = buildExpertSkillsSection();

  it("يتضمن المهارات الأربع كاملة", () => {
    expect(section).toContain(EXPERT_ACCOUNTANT_SKILL);
    expect(section).toContain(CFO_SKILL);
    expect(section).toContain(CHIEF_ACCOUNTANT_SKILL);
    expect(section).toContain(ERPNEXT_EXPERT_SKILL);
  });

  it("يتضمن عناوين الأدوار الأربعة", () => {
    expect(section).toContain("المحاسب المالي الخبير");
    expect(section).toContain("المدير المالي (CFO)");
    expect(section).toContain("رئيس الحسابات");
    expect(section).toContain("خبير ERPNext");
  });

  it("يتضمن قسم توظيف المهارات معاً", () => {
    expect(section).toContain("كيف توظّف المهارات الأربع معاً");
  });
});

describe("مهارة المحاسب الخبير", () => {
  it("تغطي القيد المزدوج وطبيعة الحسابات", () => {
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("القيد المزدوج");
    expect(EXPERT_ACCOUNTANT_SKILL).toMatch(/مدين/);
    expect(EXPERT_ACCOUNTANT_SKILL).toMatch(/دائن/);
  });
  it("تغطي VAT السعودية بنسبة 15% والرقم الضريبي", () => {
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("15%");
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("15 رقماً");
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("المخرجات");
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("المدخلات");
  });
  it("تغطي المعالجات المتخصصة (الإهلاك والمستحقات)", () => {
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("الإهلاك");
    expect(EXPERT_ACCOUNTANT_SKILL).toContain("المقدمة");
  });
});

describe("مهارة المدير المالي CFO", () => {
  it("توجّه للتحليل والتوصيات وليس عرض الأرقام فقط", () => {
    expect(CFO_SKILL).toContain("توصية");
    expect(CFO_SKILL).toContain("حلّل");
  });
  it("تتضمن مؤشرات تحذيرية (متأخرات 90 يوماً وتركّز الإيرادات)", () => {
    expect(CFO_SKILL).toContain("90 يوماً");
    expect(CFO_SKILL).toContain("تركّز");
  });
});

describe("مهارة رئيس الحسابات — الرقابة", () => {
  it("تفرض المراجعة قبل التنفيذ للمبالغ غير المعتادة", () => {
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("راجع قبل التنفيذ");
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("غير معتاد");
  });
  it("تغطي اكتشاف الازدواجية وقائمة الإقفال", () => {
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("الازدواجية");
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("الإقفال");
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("ميزان المراجعة");
  });
  it("ترفض القيود غير المتوازنة", () => {
    expect(CHIEF_ACCOUNTANT_SKILL).toContain("غير متوازن");
  });
});

describe("مهارة خبير ERPNext", () => {
  it("تغطي دورة حياة المستند وdocstatus", () => {
    expect(ERPNEXT_EXPERT_SKILL).toContain("docstatus");
    expect(ERPNEXT_EXPERT_SKILL).toContain("Submitted");
  });
  it("تغطي الأخطاء الشائعة وحلولها", () => {
    expect(ERPNEXT_EXPERT_SKILL).toContain("LinkValidationError");
    expect(ERPNEXT_EXPERT_SKILL).toContain("MandatoryError");
    expect(ERPNEXT_EXPERT_SKILL).toContain("PermissionError");
  });
  it("تفرّق بين الصنف الخدمي والمخزني", () => {
    expect(ERPNEXT_EXPERT_SKILL).toContain("is_stock_item");
  });
  it("تغطي سلسلة المستندات التجارية", () => {
    expect(ERPNEXT_EXPERT_SKILL).toContain("أمر بيع");
    expect(ERPNEXT_EXPERT_SKILL).toContain("أمر شراء");
  });
});
