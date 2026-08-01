import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// يقرأ ملف الوكيل كنص للتحقق من أن أدوات الإعدادات تدعم أي DocType
// وأن التعليمات النظامية تمنع الرفض الاستباقي للصلاحيات
// بعد تفكيك الوكيل صار المصدر موزّعاً على server/agent/ والراوتر. هذه
// التأكيدات تقرأ النص لا السلوك، فتُقرأ الوحدات كلها مجموعةً كي تبقى المقاصد
// نفسها ولا تسقط بمجرّد انتقال الكود من ملف إلى آخر.
const readAgentSource = () => {
  const dir = join(__dirname, "agent");
  const files = readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  return [
    ...files.map(f => readFileSync(join(dir, f), "utf8")),
    readFileSync(join(__dirname, "routers", "agent.ts"), "utf8"),
  ].join("\n");
};
const agentSource = readAgentSource();

describe("أدوات إعدادات الوكيل — صلاحيات كاملة", () => {
  it("settings_type لم يعد محصوراً بقائمة enum مغلقة", () => {
    // يجب ألا يوجد enum مغلق لأنواع الإعدادات في تعريف الأدوات
    // القياس السابق كان موضعياً (يقصّ من اسم الأداة إلى علامة قسم) فصار يقرأ
    // أدوات أخرى لها enum مشروع بعد التفكيك. المقصود واحد: حقل settings_type
    // نفسه لا يحصر الأنواع — فيُقاس على تعريف الحقل لا على ما حوله.
    const defs = readFileSync(join(__dirname, "agent", "toolDefinitions.ts"), "utf8");
    let seen = 0;
    for (let i = defs.indexOf("settings_type: {"); i !== -1; i = defs.indexOf("settings_type: {", i + 1)) {
      seen++;
      const block = defs.slice(i, defs.indexOf("},", i));
      expect(block, "settings_type يجب ألا يحصر الأنواع في قائمة مغلقة").not.toContain("enum:");
    }
    expect(seen, "لم يُعثر على تعريف settings_type أصلاً").toBeGreaterThan(0);
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
