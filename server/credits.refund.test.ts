import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { deductCredits, refundCredits } from "./credits";
import { getDb } from "./db";
import { users, subscriptions, creditTransactions, plans } from "../drizzle/schema";
import { eq } from "drizzle-orm";

let userId = 0;
let subId = 0;

beforeAll(async () => {
  const db = await getDb();
  const openId = `test-refund-${Date.now()}`;
  await db.insert(users).values({ openId, name: "Refund Tester", email: `${openId}@test.local` });
  const [u] = await db.select().from(users).where(eq(users.openId, openId));
  userId = u.id;
  const [plan] = await db.select().from(plans).limit(1);
  await db.insert(subscriptions).values({
    userId, planId: plan.id, status: "active", creditsBalance: 100,
    currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
  } as never);
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  subId = s.id;
  // تسخين: أول خصم يشغّل تعبئة الدورة الشهرية فيقفز الرصيد. تجاوزه هنا كي
  // تقيس الاختبارات أثر الردّ وحده لا أثر التعبئة معه.
  await deductCredits(userId, 1, "message", "تسخين");
  await refundCredits(userId, 1, "تسخين");
});

afterAll(async () => {
  const db = await getDb();
  if (!userId) return;
  await db.delete(creditTransactions).where(eq(creditTransactions.userId, userId));
  await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

const balance = async () => {
  const db = await getDb();
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, subId));
  return s.creditsBalance;
};
const txCount = async () => {
  const db = await getDb();
  return (await db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId))).length;
};

describe("refundCredits", () => {
  it("يعيد الرصيد إلى ما كان عليه قبل الخصم", async () => {
    const before = await balance();
    await deductCredits(userId, 3, "message", "اختبار");
    expect(await balance()).toBe(before - 3);
    await refundCredits(userId, 3, "اختبار ردّ");
    expect(await balance()).toBe(before);
  });

  // الحركة تُسجَّل لا تُمحى: عدّاد الاستهلاك يُبنى من الحركات، والردّ جزء من السجل
  it("يسجّل الردّ كحركة مستقلة لا يحذف حركة الخصم", async () => {
    const before = await txCount();
    await deductCredits(userId, 2, "message");
    await refundCredits(userId, 2);
    expect(await txCount()).toBe(before + 2);
  });

  it("يتجاهل قيمة صفرية أو سالبة بلا أثر", async () => {
    const b = await balance(), t = await txCount();
    await refundCredits(userId, 0);
    await refundCredits(userId, -5);
    expect(await balance()).toBe(b);
    expect(await txCount()).toBe(t);
  });

  it("لا ينهار على مستخدم بلا اشتراك", async () => {
    await expect(refundCredits(999_999_99, 5)).resolves.toBeUndefined();
  });

  // الحساب المفتوح لم يُنقَص رصيده فلا يُزاد — لكن حركته تُسجَّل
  it("الحساب المفتوح: حركة بلا تغيير رصيد", async () => {
    const db = await getDb();
    await db.update(subscriptions).set({ unlimitedCredits: true } as never).where(eq(subscriptions.id, subId));
    const b = await balance(), t = await txCount();
    await deductCredits(userId, 4, "message");
    await refundCredits(userId, 4);
    expect(await balance()).toBe(b);
    expect(await txCount()).toBe(t + 2);
    await db.update(subscriptions).set({ unlimitedCredits: false } as never).where(eq(subscriptions.id, subId));
  });
});
