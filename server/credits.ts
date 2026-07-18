// ─── نظام نقاط الرصيد الشهرية ─────────────────────────────────────────────────
// كل رسالة للوكيل = 1 نقطة، كل مستند يُنشأ في ERP = 5 نقاط
// رصيد الباقة الشهري = maxDocuments × 5 (150 / 250 / 500)
// الشحن الإضافي: كل 100 نقطة = 100 ريال سعودي
import { getDb } from "./db";
import { subscriptions, plans, creditTransactions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

export const MESSAGE_COST = 1;
export const DOCUMENT_COST = 5;
export const CREDITS_PER_DOCUMENT = 5;
// سعر شحن النقاط: 100 نقطة = 100 ريال (أي 1 ريال للنقطة)
export const TOPUP_UNIT_CREDITS = 100;
export const TOPUP_UNIT_PRICE_SAR = 100;
// طول الدورة الشهرية بالمللي ثانية (30 يوماً)
export const CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

export function topupPriceSAR(credits: number): number {
  // النقاط تُشحن بمضاعفات 100
  return (credits / TOPUP_UNIT_CREDITS) * TOPUP_UNIT_PRICE_SAR;
}

export function isValidTopupCredits(credits: number): boolean {
  return Number.isInteger(credits) && credits >= TOPUP_UNIT_CREDITS && credits % TOPUP_UNIT_CREDITS === 0;
}

// حساب السعر السنوي بعد خصم 15%
export function yearlyPrice(monthlyPrice: number, discountPct = 15): number {
  return Math.round(monthlyPrice * 12 * (1 - discountPct / 100));
}

async function logTransaction(data: {
  userId: number;
  subscriptionId?: number | null;
  type: "message" | "document" | "monthly_refill" | "topup" | "adjustment";
  amount: number;
  balanceAfter: number;
  note?: string;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(creditTransactions).values({
    userId: data.userId,
    subscriptionId: data.subscriptionId ?? undefined,
    type: data.type,
    amount: data.amount,
    balanceAfter: data.balanceAfter,
    note: data.note,
  });
}

/**
 * يجلب اشتراك المستخدم ويجدد رصيده الشهري إذا انقضت الدورة (30 يوماً).
 * التجديد يعيد الرصيد إلى قيمة الباقة الشهرية (لا يجمع المتبقي).
 */
export async function ensureCreditsCycle(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  const { sub, plan } = row;

  const now = Date.now();
  const cycleStart = sub.creditsCycleStart ? new Date(sub.creditsCycleStart).getTime() : 0;
  if (!cycleStart || now - cycleStart >= CYCLE_MS) {
    const newBalance = plan.monthlyCredits;
    await db
      .update(subscriptions)
      .set({ creditsBalance: newBalance, creditsCycleStart: new Date() })
      .where(eq(subscriptions.id, sub.id));
    await logTransaction({
      userId,
      subscriptionId: sub.id,
      type: "monthly_refill",
      amount: newBalance,
      balanceAfter: newBalance,
      note: `تعبئة شهرية لباقة ${plan.nameAr}`,
    });
    return { ...sub, creditsBalance: newBalance, creditsCycleStart: new Date(), plan };
  }
  return { ...sub, plan };
}

/** يرجع الرصيد الحالي بعد ضمان تجديد الدورة */
export async function getCreditsBalance(userId: number) {
  const sub = await ensureCreditsCycle(userId);
  if (!sub) return undefined;
  return {
    balance: sub.creditsBalance,
    monthlyCredits: sub.plan.monthlyCredits,
    cycleStart: sub.creditsCycleStart,
    planNameAr: sub.plan.nameAr,
  };
}

export class InsufficientCreditsError extends Error {
  constructor(public balance: number, public required: number) {
    super(
      `رصيد النقاط غير كافٍ (المتبقي ${balance} نقطة، المطلوب ${required}). يمكنك شحن رصيد إضافي: كل 100 نقطة = 100 ريال سعودي من صفحة الاشتراك.`
    );
    this.name = "InsufficientCreditsError";
  }
}

/**
 * يخصم نقاطاً من رصيد المستخدم. يرمي InsufficientCreditsError إذا كان الرصيد لا يكفي.
 */
export async function deductCredits(
  userId: number,
  cost: number,
  type: "message" | "document",
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sub = await ensureCreditsCycle(userId);
  if (!sub) throw new Error("لا يوجد اشتراك نشط");
  if (sub.creditsBalance < cost) {
    throw new InsufficientCreditsError(sub.creditsBalance, cost);
  }
  const newBalance = sub.creditsBalance - cost;
  await db
    .update(subscriptions)
    .set({ creditsBalance: newBalance })
    .where(eq(subscriptions.id, sub.id));
  await logTransaction({
    userId,
    subscriptionId: sub.id,
    type,
    amount: -cost,
    balanceAfter: newBalance,
    note,
  });
  return newBalance;
}

/** يضيف نقاطاً مشحونة (بعد نجاح الدفع) */
export async function addTopupCredits(userId: number, credits: number, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  const sub = rows[0];
  if (!sub) throw new Error("لا يوجد اشتراك");
  const newBalance = sub.creditsBalance + credits;
  await db
    .update(subscriptions)
    .set({ creditsBalance: newBalance })
    .where(eq(subscriptions.id, sub.id));
  await logTransaction({
    userId,
    subscriptionId: sub.id,
    type: "topup",
    amount: credits,
    balanceAfter: newBalance,
    note: note ?? `شحن ${credits} نقطة`,
  });
  return newBalance;
}

/** سجل حركات النقاط الأخيرة للمستخدم */
export async function getCreditTransactions(userId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const { desc } = await import("drizzle-orm");
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit);
}
