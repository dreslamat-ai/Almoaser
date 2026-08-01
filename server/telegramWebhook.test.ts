import { describe, it, expect } from "vitest";
import { chunkForTelegram, agentReplyToTelegram } from "./telegramWebhook";
import { readFileSync } from "fs";

describe("chunkForTelegram", () => {
  it("يترك الرد القصير كما هو", () => {
    expect(chunkForTelegram("رد قصير")).toEqual(["رد قصير"]);
  });

  // حد تيليجرام 4096: رد أطول يُرفض كاملاً لا يُقتطع
  it("يقسّم الرد الطويل ولا يفقد منه شيئاً", () => {
    const long = Array.from({ length: 300 }, (_, i) => `سطر رقم ${i}`).join("\n");
    const parts = chunkForTelegram(long, 500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    expect(parts.join("\n").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
  });

  it("يفضّل القطع عند نهاية سطر لا في منتصف كلمة", () => {
    const text = "أ".repeat(80) + "\n" + "ب".repeat(80);
    const [first] = chunkForTelegram(text, 100);
    expect(first).toBe("أ".repeat(80));
  });
});

describe("agentReplyToTelegram", () => {
  it("يحوّل ماركداون الوكيل لوسوم تيليجرام", () => {
    expect(agentReplyToTelegram("**الإجمالي** ٥٠٠")).toBe("<b>الإجمالي</b> ٥٠٠");
    expect(agentReplyToTelegram("رقم `INV-001`")).toBe("رقم <code>INV-001</code>");
  });

  // اسم عميل فيه قوس زاوية يكسر الرسالة كلها إن لم يُهرَّب قبل التحويل
  it("يهرّب قبل أن يحوّل فلا يُفسَّر نص العميل كوسم", () => {
    const out = agentReplyToTelegram("عميل <script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  // سطر الأزرار للواجهة فقط — ظهوره في تيليجرام يكشف تعليمات داخلية
  it("يحذف سطر الأزرار السريعة", () => {
    const out = agentReplyToTelegram("تم.\n[QUICK_REPLIES: نعم | لا]");
    expect(out).not.toContain("QUICK_REPLIES");
    expect(out).toContain("تم.");
  });

  it("يترك النص العادي سليماً", () => {
    expect(agentReplyToTelegram("لديك ٣ فواتير غير مدفوعة")).toBe("لديك ٣ فواتير غير مدفوعة");
  });
});

// كانت الأزرار تُستخرج من نصّ الرد بعد أن نزعها agent.chat — فترجع فارغة دائماً
describe("مصدر الأزرار في تيليجرام", () => {
  it("لا يعتمد على وجود العلامة في النص", () => {
    const src = readFileSync(new URL("./telegramWebhook.ts", import.meta.url), "utf8");
    expect(src).toContain("r.quickReplies?.length");
  });
});
