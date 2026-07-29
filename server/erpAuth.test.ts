import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildErpOpenId, verifyErpCredentials, loginWithErpAccount, signupWithErpAccount, activateTrialIfExpired, loginWithStoredConnection } from "./erpAuth";
import { getDb } from "./db";
import { users, subscriptions, erpnextConnections } from "../drizzle/schema";
import { eq, like } from "drizzle-orm";

const ERP_URL = "https://test.erpnext.example";
const ODOO_URL = "https://test.odoo.example";
const TEST_EMAIL = `vitest-erpauth-${Date.now()}@test.local`;

function mockFetchLogin(ok: boolean, fullName = "مستخدم الاختبار") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (ok) {
      return new Response(JSON.stringify({ message: "Logged In", full_name: fullName }), {
        status: 200,
        headers: { "set-cookie": "sid=abc123session; Path=/" },
      });
    }
    return new Response(JSON.stringify({ message: "Invalid" }), { status: 401 });
  });
}

function mockOdooLogin(ok: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify({ result: ok ? 42 : false }), { status: 200 });
  });
}

async function cleanupTestData() {
  const db = await getDb();
  if (!db) return;
  const rows = await db.select().from(users).where(like(users.email, "vitest-erpauth-%"));
  for (const u of rows) {
    await db.delete(subscriptions).where(eq(subscriptions.userId, u.id));
    await db.delete(erpnextConnections).where(eq(erpnextConnections.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
  }
}

describe("buildErpOpenId", () => {
  it("ينتج معرفاً ثابتاً وفريداً بطول <= 64", () => {
    const a = buildErpOpenId(ERP_URL, "user@example.com");
    const b = buildErpOpenId(ERP_URL, "user@example.com");
    const c = buildErpOpenId(ERP_URL, "other@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.startsWith("erp:")).toBe(true);
  });

  it("لا يتأثر بحالة الأحرف أو الشرطة المائلة الأخيرة", () => {
    const a = buildErpOpenId(ERP_URL + "/", "User@Example.com ");
    const b = buildErpOpenId(ERP_URL, "user@example.com");
    expect(a).toBe(b);
  });
});

describe("verifyErpCredentials", () => {
  afterEach(() => vi.restoreAllMocks());

  it("ينجح عند بيانات صحيحة ويرجع الاسم الكامل", async () => {
    mockFetchLogin(true, "أحمد التجريبي");
    const res = await verifyErpCredentials(ERP_URL, "a@b.com", "pass");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fullName).toBe("أحمد التجريبي");
  });

  it("يفشل برسالة عربية عند 401", async () => {
    mockFetchLogin(false);
    const res = await verifyErpCredentials(ERP_URL, "a@b.com", "wrong");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("غير صحيحة");
  });

  it("يفشل عند جلسة Guest (بيانات غير صالحة)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "set-cookie": "sid=Guest; Path=/" } })
    );
    const res = await verifyErpCredentials(ERP_URL, "a@b.com", "x");
    expect(res.ok).toBe(false);
  });
});

describe("loginWithErpAccount + signupWithErpAccount", () => {
  beforeEach(async () => { await cleanupTestData(); });
  afterEach(async () => { vi.restoreAllMocks(); await cleanupTestData(); });

  it("التسجيل الجديد ينشئ الحساب والاتصال واشتراكاً تجريبياً 3 أيام", async () => {
    mockFetchLogin(true, "مستخدم جديد");
    const res = await signupWithErpAccount({
      erpUrl: ERP_URL,
      email: TEST_EMAIL,
      password: "secret123",
      planId: 1,
      companyName: "شركة الاختبار",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;

    // الحساب أنشئ بالبريد الصحيح وطريقة الدخول erpnext
    const userRows = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(userRows.length).toBe(1);
    expect(userRows[0].loginMethod).toBe("erpnext");

    // الاتصال محفوظ ومشفر (ليس نص كلمة المرور الخام)
    const connRows = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, userRows[0].id));
    expect(connRows.length).toBe(1);
    expect(connRows[0].url).toBe(ERP_URL);
    expect(connRows[0].passwordEnc).not.toContain("secret123");

    // اشتراك تجريبي 3 أيام
    const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userRows[0].id));
    expect(subRows.length).toBe(1);
    expect(subRows[0].status).toBe("trial");
    expect(subRows[0].planId).toBe(1);
    const diffDays = (subRows[0].endDate!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(2.8);
    expect(diffDays).toBeLessThanOrEqual(3.05);
  });

  it("تسجيل الدخول بعد التسجيل يعيد استخدام نفس الحساب ولا يكرره", async () => {
    mockFetchLogin(true, "مستخدم جديد");
    const signup = await signupWithErpAccount({ erpUrl: ERP_URL, email: TEST_EMAIL, password: "secret123", planId: 2 });
    expect(signup.ok).toBe(true);

    const login = await loginWithErpAccount(ERP_URL, TEST_EMAIL, "secret123");
    expect(login.ok).toBe(true);
    if (!login.ok || !signup.ok) return;
    expect(login.result.openId).toBe(signup.result.openId);

    const db = await getDb();
    if (!db) return;
    const userRows = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(userRows.length).toBe(1);
  });

  it("تسجيل الدخول ببيانات خاطئة يفشل ولا ينشئ حساباً", async () => {
    mockFetchLogin(false);
    const res = await loginWithErpAccount(ERP_URL, TEST_EMAIL, "wrong");
    expect(res.ok).toBe(false);
    const db = await getDb();
    if (!db) return;
    const userRows = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(userRows.length).toBe(0);
  });

  it("التسجيل برابط غير صالح يرفض قبل الاتصال", async () => {
    const res = await signupWithErpAccount({ erpUrl: "not-a-url", email: TEST_EMAIL, password: "x", planId: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("https://");
  });

  it("بعد انتهاء التجربة تُفعَّل الباقة تلقائياً بدورة شهرية", async () => {
    mockFetchLogin(true);
    const signup = await signupWithErpAccount({ erpUrl: ERP_URL, email: TEST_EMAIL, password: "secret123", planId: 2 });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    const db = await getDb();
    if (!db) return;
    const userRows = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    const userId = userRows[0].id;

    // التجربة ما زالت سارية → لا تغيير
    await activateTrialIfExpired(userId);
    let subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(subRows[0].status).toBe("trial");

    // نُرجع نهاية التجربة إلى الماضي ثم نتحقق من التفعيل التلقائي
    const pastEnd = new Date(Date.now() - 60 * 60 * 1000);
    await db.update(subscriptions).set({ endDate: pastEnd }).where(eq(subscriptions.id, subRows[0].id));
    await activateTrialIfExpired(userId);
    subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
    expect(subRows[0].status).toBe("active");
    expect(subRows[0].planId).toBe(2);
    // دورة شهرية تبدأ من نهاية التجربة
    const expectedCycleEnd = pastEnd.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(subRows[0].endDate!.getTime() - expectedCycleEnd)).toBeLessThan(5000);
  });

  it("التسجيل بحساب Odoo يخزّن provider=odoo واسم قاعدة البيانات", async () => {
    mockOdooLogin(true);
    const res = await signupWithErpAccount({
      erpUrl: ODOO_URL,
      email: TEST_EMAIL,
      password: "secret123",
      planId: 1,
      provider: "odoo",
      database: "my_company_db",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const db = await getDb();
    if (!db) return;
    const userRows = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(userRows[0].loginMethod).toBe("odoo");
    const connRows = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, userRows[0].id));
    expect(connRows[0].provider).toBe("odoo");
    expect(connRows[0].database).toBe("my_company_db");
  });

  it("التسجيل بحساب Odoo بدون اسم قاعدة بيانات يُرفض", async () => {
    const res = await signupWithErpAccount({
      erpUrl: ODOO_URL, email: TEST_EMAIL, password: "secret123", planId: 1, provider: "odoo",
    });
    expect(res.ok).toBe(false);
  });

  it("تسجيل الدخول العائد (بدون رابط) يجد الاتصال المحفوظ ويتحقق مقابله", async () => {
    mockFetchLogin(true, "مستخدم عائد");
    const signup = await signupWithErpAccount({ erpUrl: ERP_URL, email: TEST_EMAIL, password: "secret123", planId: 1 });
    expect(signup.ok).toBe(true);
    if (!signup.ok) return;

    // نفس بيانات الاعتماد، لكن بدون تمرير erpUrl — يجب أن يجد الرابط المحفوظ تلقائياً
    const login = await loginWithStoredConnection(TEST_EMAIL, "secret123");
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.result.openId).toBe(signup.result.openId);
  });

  it("تسجيل الدخول العائد بكلمة مرور خاطئة يفشل", async () => {
    mockFetchLogin(true, "مستخدم عائد");
    const signup = await signupWithErpAccount({ erpUrl: ERP_URL, email: TEST_EMAIL, password: "secret123", planId: 1 });
    expect(signup.ok).toBe(true);

    mockFetchLogin(false);
    const login = await loginWithStoredConnection(TEST_EMAIL, "wrong");
    expect(login.ok).toBe(false);
  });
});
