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

// كان بوت المالك يوجّه رسائله إلى `agent.chat` — وكيل نظام العميل — فيجيب عن
// ERPNext حين يُسأل عن اشتراك أو استهلاك. صار يوجّهها إلى وكيل الإدارة.
describe("وجهة رسائل المالك", () => {
  const src = readFileSync(new URL("./telegramWebhook.ts", import.meta.url), "utf8");

  it("تذهب إلى وكيل الإدارة", () => {
    expect(src).toContain("runAdminAgent");
  });

  // المسار القديم حُذف لا عُطِّل: كودٌ ميت يبقى يُقرأ كأنه حيّ، ويعود بسهو
  it("لا يبقى مسار وكيل المحاسبة", () => {
    expect(src).not.toContain("caller.agent.chat");
  });
});

// أدوات المالك تُنفَّذ عبر نفس المستدعي الذي يبنيه الموقع، فتسري الصلاحيات
// وسجل التدقيق — ولا يوجد طريق خلفي يلتفّ عليهما.
describe("أدوات وكيل الإدارة", () => {
  const src = readFileSync(new URL("./adminAgent.ts", import.meta.url), "utf8");

  it("لا أداة حذف", () => {
    const names = Array.from(src.matchAll(/name: "([a-z_]+)"/g)).map(m => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(/delete|remove|destroy|drop|purge/.test(n)).toBe(false);
  });

  it("لا يُنشئ فواتير عملاء — ذلك عمل وكيل آخر", () => {
    expect(src).not.toContain("create_invoice");
  });
});
