// ─── اختبارات تكامل الدفع MyFatoorah: منطق التفعيل بعد الدفع ─────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// محاكاة وحدة MyFatoorah (لا نتصل بالبوابة الفعلية في الاختبارات)
const getPaymentStatusMock = vi.fn();
vi.mock("./myfatoorah", () => ({
  isMyFatoorahConfigured: () => true,
  createPaymentLink: vi.fn(async () => ({
    InvoiceId: 12345,
    InvoiceURL: "https://portal.myfatoorah.com/pay/12345",
  })),
  getPaymentStatus: (...args: unknown[]) => getPaymentStatusMock(...args),
}));

// محاكاة قاعدة البيانات ودوالها
const paymentRow: Record<string, unknown> = {};
const updateSubscriptionMock = vi.fn();
const dbUpdateSetMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [paymentRow] }),
      }),
    }),
    update: () => ({ set: dbUpdateSetMock }),
    insert: () => ({ values: async () => [{ insertId: 1 }] }),
  }),
  getPlanById: async (id: number) =>
    id === 2 ? { id: 2, nameAr: "الاحترافية", price: "699", yearlyDiscountPct: 15, monthlyCredits: 300 } : null,
  getSubscriptionByUserId: async () => ({ id: 10, userId: 1, planId: 1, status: "trial" }),
  updateSubscription: (...args: unknown[]) => updateSubscriptionMock(...args),
}));

const addTopupCreditsMock = vi.fn();
vi.mock("./credits", async importOriginal => {
  const actual = await importOriginal<typeof import("./credits")>();
  return { ...actual, addTopupCredits: (...args: unknown[]) => addTopupCreditsMock(...args) };
});

import { paymentsRouter } from "./routers/payments";
import { yearlyPrice, topupPriceSAR, isValidTopupCredits, TOPUP_MIN_CREDITS } from "./credits";

function makeCaller() {
  return paymentsRouter.createCaller({
    user: { id: 1, name: "مستخدم اختبار", email: "test@example.com", role: "user" },
    req: { headers: { origin: "https://almoaser.manus.space" } },
    res: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(paymentRow)) delete paymentRow[k];
});

describe("verifyPayment — تفعيل الاشتراك بعد الدفع", () => {
  it("دفع اشتراك ناجح يفعّل الباقة بدورة شهرية ويعيد تعبئة النقاط", async () => {
    Object.assign(paymentRow, {
      id: 55, userId: 1, purpose: "subscription", planId: 2,
      billing: "monthly", status: "pending", credits: null,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Paid", CustomerReference: "55" });

    const res = await makeCaller().verifyPayment({ mfPaymentId: "MF-1" });
    expect(res).toEqual({ status: "paid", purpose: "subscription" });

    // تم تحديث حالة الدفع إلى paid
    expect(dbUpdateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
    // تم تفعيل الاشتراك بالباقة الجديدة مع رصيد نقاط الباقة
    expect(updateSubscriptionMock).toHaveBeenCalledWith(10, expect.objectContaining({
      planId: 2, status: "active", billing: "monthly", creditsBalance: 300,
    }));
    const endDate = updateSubscriptionMock.mock.calls[0][1].endDate as Date;
    const days = (endDate.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it("دفع اشتراك سنوي يمدد النهاية 365 يوماً", async () => {
    Object.assign(paymentRow, {
      id: 56, userId: 1, purpose: "subscription", planId: 2,
      billing: "yearly", status: "pending", credits: null,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Paid", CustomerReference: "56" });

    await makeCaller().verifyPayment({ mfPaymentId: "MF-2" });
    const endDate = updateSubscriptionMock.mock.calls[0][1].endDate as Date;
    const days = (endDate.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);
  });

  it("دفع شحن نقاط ناجح يضيف النقاط للرصيد", async () => {
    Object.assign(paymentRow, {
      id: 57, userId: 1, purpose: "topup", planId: null,
      billing: null, status: "pending", credits: 200,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Paid", CustomerReference: "57" });

    const res = await makeCaller().verifyPayment({ mfPaymentId: "MF-3" });
    expect(res).toEqual({ status: "paid", purpose: "topup" });
    expect(addTopupCreditsMock).toHaveBeenCalledWith(1, 200, expect.stringContaining("200"));
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  it("دفع غير مكتمل يُوسم failed ولا يُفعّل شيئاً", async () => {
    Object.assign(paymentRow, {
      id: 58, userId: 1, purpose: "subscription", planId: 2,
      billing: "monthly", status: "pending", credits: null,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Pending", CustomerReference: "58" });

    const res = await makeCaller().verifyPayment({ mfPaymentId: "MF-4" });
    expect(res).toEqual({ status: "failed", purpose: "subscription" });
    expect(dbUpdateSetMock).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(addTopupCreditsMock).not.toHaveBeenCalled();
  });

  it("دفعة مدفوعة سابقاً لا تُفعَّل مرتين (idempotent)", async () => {
    Object.assign(paymentRow, {
      id: 59, userId: 1, purpose: "subscription", planId: 2,
      billing: "monthly", status: "paid", credits: null,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Paid", CustomerReference: "59" });

    const res = await makeCaller().verifyPayment({ mfPaymentId: "MF-5" });
    expect(res).toEqual({ status: "paid", purpose: "subscription" });
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(dbUpdateSetMock).not.toHaveBeenCalled();
  });

  it("يرفض دفعة تعود لمستخدم آخر", async () => {
    Object.assign(paymentRow, {
      id: 60, userId: 999, purpose: "subscription", planId: 2,
      billing: "monthly", status: "pending", credits: null,
    });
    getPaymentStatusMock.mockResolvedValue({ InvoiceStatus: "Paid", CustomerReference: "60" });

    await expect(makeCaller().verifyPayment({ mfPaymentId: "MF-6" })).rejects.toThrow();
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });
});

describe("دوال التسعير المساعدة", () => {
  it("السعر السنوي = 12 شهراً بخصم 15%", () => {
    expect(yearlyPrice(699, 15)).toBe(Math.round(699 * 12 * 0.85));
  });
  it("سعر الشحن: الريال يشتري خمس نقاط", () => {
    expect(topupPriceSAR(200)).toBe(40);
  });
  // كانت القاعدة مضاعفات 100؛ صارت أي عدد ابتداءً من الحد الأدنى
  it("الشحن بأي عدد ابتداءً من الحد الأدنى", () => {
    expect(isValidTopupCredits(100)).toBe(true);
    expect(isValidTopupCredits(150)).toBe(true);
    expect(isValidTopupCredits(TOPUP_MIN_CREDITS - 1)).toBe(false);
  });
});
