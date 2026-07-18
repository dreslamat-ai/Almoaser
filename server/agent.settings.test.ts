import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// يقرأ ملف الوكيل كنص للتحقق من أن أدوات الإعدادات تدعم أي DocType
// وأن التعليمات النظامية تمنع الرفض الاستباقي للصلاحيات
const agentSource = readFileSync(join(__dirname, "routers", "agent.ts"), "utf8");

describe("أدوات إعدادات الوكيل — صلاحيات كاملة", () => {
  it("settings_type لم يعد محصوراً بقائمة enum مغلقة", () => {
    // يجب ألا يوجد enum مغلق لأنواع الإعدادات في تعريف الأدوات
    const toolsSection = agentSource.slice(
      agentSource.indexOf('name: "get_settings"'),
      agentSource.indexOf("// ─── Tool Executor")
    );
    expect(toolsSection).not.toContain("enum:");
  });

  it("أداة update_settings تدعم Mode of Payment وربط الحسابات عبر الجدول الفرعي accounts", () => {
    expect(agentSource).toContain("Mode of Payment");
    expect(agentSource).toContain("default_account");
  });

  it("التعليمات النظامية تتضمن قاعدة عدم الرفض الاستباقي", () => {
    expect(agentSource).toContain("قاعدة عدم الرفض الاستباقي");
    expect(agentSource).toContain("نفس صلاحيات مستخدم ERPNext المتصل");
  });

  it("منفّذ update_settings يمرر الحقول كما هي (يدعم الجداول الفرعية كمصفوفات)", () => {
    // التنفيذ يستخدم erpPUT(path, fields) مباشرة دون تصفية للحقول
    const execSection = agentSource.slice(
      agentSource.lastIndexOf('case "update_settings"')
    );
    expect(execSection).toContain("erpPUT(path, fields)");
  });

  it("منفّذ get_settings يتعامل مع Single DocTypes وقوائم السجلات", () => {
    const execSection = agentSource.slice(
      agentSource.lastIndexOf('case "get_settings"'),
      agentSource.lastIndexOf('case "update_settings"')
    );
    expect(execSection).toContain("SINGLE_DOCTYPES");
    expect(execSection).toContain("available");
  });
});
