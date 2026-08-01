import { describe, it, expect, vi } from "vitest";
import {
  PLATFORM_TOOLS, PLATFORM_TOOL_NAMES, PLATFORM_WRITE_TOOLS,
  canUsePlatformTools, executePlatformTool,
} from "./platformTools";

const caller = (impl: Record<string, (i?: unknown) => Promise<unknown>>) => ({ admin: impl });

describe("canUsePlatformTools", () => {
  // الدور يُقرأ من القاعدة — هذه آخر بوابة قبل عمليات تمسّ حسابات تدفع
  it("للمسؤول وحده", () => {
    expect(canUsePlatformTools({ role: "admin" })).toBe(true);
    expect(canUsePlatformTools({ role: "user" })).toBe(false);
  });
});

describe("تسجيل أدوات المنصة", () => {
  it("كل أداة لها اسم يبدأ بـplatform_ ووصف ومخطط", () => {
    for (const t of PLATFORM_TOOLS) {
      expect(t.function.name).toMatch(/^platform_/);
      expect(t.function.description).toBeTruthy();
      expect(t.function.parameters).toBeTruthy();
    }
  });

  it("لا اسم مكرر", () => {
    expect(PLATFORM_TOOL_NAMES.size).toBe(PLATFORM_TOOLS.length);
  });

  // ما يغيّر حالة يجب أن يكون معلوماً كي تُفرض عليه قاعدة التأكيد
  it("كل أداة كتابة مسجّلة في قائمة الكتابة", () => {
    for (const name of PLATFORM_WRITE_TOOLS) expect(PLATFORM_TOOL_NAMES.has(name)).toBe(true);
    expect(PLATFORM_WRITE_TOOLS.has("platform_users")).toBe(false);
  });
});

describe("executePlatformTool", () => {
  it("يستدعي إجراء الإدارة لا القاعدة مباشرة", async () => {
    const users = vi.fn(async () => [{ id: 1, email: "a@b.c" }]);
    const r = await executePlatformTool("platform_users", {}, caller({ users }));
    expect(users).toHaveBeenCalled();
    expect(r.result).toEqual([{ id: 1, email: "a@b.c" }]);
  });

  it("يمرّر المعاملات كما هي لتفعيل الاشتراك", async () => {
    const activateSubscription = vi.fn(async () => ({ ok: true }));
    await executePlatformTool("platform_activate_subscription",
      { userId: "7", planId: 2, billing: "yearly" }, caller({ activateSubscription }));
    expect(activateSubscription).toHaveBeenCalledWith({ userId: 7, planId: 2, billing: "yearly" });
  });

  it("يعامل دورة فوترة غير معروفة كشهرية لا كقيمة تمرّ للقاعدة", async () => {
    const activateSubscription = vi.fn(async () => ({}));
    await executePlatformTool("platform_activate_subscription",
      { userId: 1, planId: 1, billing: "weekly" }, caller({ activateSubscription }));
    expect(activateSubscription).toHaveBeenCalledWith({ userId: 1, planId: 1, billing: "monthly" });
  });

  // الحقول غير المذكورة تُحذف لا تُرسل undefined: القاعدة تفرّق بين الغياب والفراغ
  it("يحذف حقول الكوبون غير المذكورة", async () => {
    const createCoupon = vi.fn(async () => ({ id: 1 }));
    await executePlatformTool("platform_create_coupon",
      { code: "WELCOME", type: "percent", value: 20 }, caller({ createCoupon }));
    const arg = createCoupon.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("maxUses");
    expect(arg.code).toBe("WELCOME");
  });

  it("يرفض قيمة رقمية غير صالحة بدل تمريرها", async () => {
    await expect(executePlatformTool("platform_grant_credits",
      { userId: "غير رقم", credits: 5 }, caller({ grantCredits: async () => ({}) }))).rejects.toThrow();
  });

  it("يرفض أداة غير معروفة", async () => {
    await expect(executePlatformTool("platform_drop_database", {}, caller({}))).rejects.toThrow("غير معروفة");
  });
});
