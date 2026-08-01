import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

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

describe("create_payment_entry — حل طريقة الدفع والأخطاء", () => {
  it("يحل mode_of_payment بمطابقة ذكية مع طرق الدفع الفعلية", () => {
    const section = agentSource.slice(
      agentSource.indexOf('case "create_payment_entry"'),
      agentSource.indexOf('case "get_accounts"')
    );
    expect(section).toContain("Mode%20of%20Payment");
    expect(section).toContain("mode_of_payment_not_found");
    expect(section).toContain("available_modes");
  });

  it("يدعم الترجمة الإنجليزية الشائعة لطرق الدفع (cash → نقد)", () => {
    expect(agentSource).toContain('cash: ["نقد"');
    expect(agentSource).toContain('cheque: ["شيك"]');
  });

  it("يجلب الحسابات الافتراضية من إعدادات الشركة تلقائياً", () => {
    const section = agentSource.slice(
      agentSource.indexOf('case "create_payment_entry"'),
      agentSource.indexOf('case "get_accounts"')
    );
    expect(section).toContain("default_receivable_account");
    expect(section).toContain("default_cash_account");
  });

  it("ترجمة الأخطاء تنقل اسم السجل المفقود من رسائل ERPNext المعرّبة", () => {
    expect(agentSource).toContain("لا يمكن أن تجد");
  });
});
