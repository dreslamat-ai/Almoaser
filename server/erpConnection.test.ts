import { describe, it, expect } from "vitest";
import { explainErpFailure } from "./erpConnection";

// رد فرابي حقيقي الشكل: الحالة وحدها لا تكفي، السبب في الجسم
const res = (status: number, body: string, type = "application/json") =>
  new Response(body, { status, headers: { "content-type": type } });

describe("explainErpFailure", () => {
  it("يترجم كلمة مرور خاطئة بدل عرض 401", async () => {
    const msg = await explainErpFailure(res(401, JSON.stringify({ message: "Incorrect password" })));
    expect(msg).toContain("كلمة المرور");
    expect(msg).not.toContain("401");
  });

  it("يميّز الحساب الموقوف عن كلمة المرور الخاطئة", async () => {
    const msg = await explainErpFailure(res(401, JSON.stringify({ message: "User disabled or missing" })));
    expect(msg).toContain("موقوف");
  });

  // المزلق الشائع: العميل يلصق رابط موقعه لا رابط النظام، فيرد HTML
  it("يكشف أن الرابط ليس ERPNext إذا رد HTML", async () => {
    const msg = await explainErpFailure(res(404, "<html><body>Not Found</body></html>", "text/html"));
    expect(msg).toContain("لا يشير إلى نظام ERPNext");
  });

  it("يذكر التحقق الثنائي عند 401 بلا سبب معلن", async () => {
    const msg = await explainErpFailure(res(401, ""));
    expect(msg).toContain("تحققاً ثنائياً");
  });

  it("ينسب أخطاء 5xx لخادم العميل لا لبياناته", async () => {
    const msg = await explainErpFailure(res(500, JSON.stringify({})));
    expect(msg).toContain("خادم ERPNext");
  });

  it("ينصح بالانتظار عند تجاوز حد المحاولات", async () => {
    expect(await explainErpFailure(res(429, ""))).toContain("انتظر");
  });

  it("ينقل نص الخادم كما هو إن لم يعرفه", async () => {
    const msg = await explainErpFailure(res(400, JSON.stringify({ message: "Something odd" })));
    expect(msg).toContain("Something odd");
  });
});
