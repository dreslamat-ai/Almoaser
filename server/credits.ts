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

/**
 * سجل حركات النقاط الأخيرة للمنظمة (كل حركات كل أعضائها، وليس عضواً واحداً فقط)
 * — يبحث عن الاشتراك عبر ownerUserId (مالك المنظمة) ثم يفلتر بـ subscriptionId
 */
export async function getCreditTransactions(ownerUserId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const { desc } = await import("drizzle-orm");
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, ownerUserId)).limit(1);
  const sub = subRows[0];
  if (!sub) return [];
  return db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.subscriptionId, sub.id))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit);
}

/** ملخص استهلاك منظمة واحدة: إجمالي المستندات/الرسائل + تفصيل لكل عضو */
export async function getOrgUsageSummary(ownerUserId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const { sql } = await import("drizzle-orm");
  const subRows = await db.select().from(subscriptions).where(eq(subscriptions.userId, ownerUserId)).limit(1);
  const sub = subRows[0];
  if (!sub) return undefined;

  const rows = await db
    .select({
      userId: creditTransactions.userId,
      type: creditTransactions.type,
      count: sql<number>`count(*)`,
      totalAmount: sql<number>`sum(${creditTransactions.amount})`,
    })
    .from(creditTransactions)
    .where(eq(creditTransactions.subscriptionId, sub.id))
    .groupBy(creditTransactions.userId, creditTransactions.type);

  const byMember = new Map<number, { userId: number; documents: number; messages: number }>();
  let totalDocuments = 0;
  let totalMessages = 0;
  for (const r of rows) {
    if (r.type !== "document" && r.type !== "message") continue;
    const entry = byMember.get(r.userId) ?? { userId: r.userId, documents: 0, messages: 0 };
    if (r.type === "document") { entry.documents += Number(r.count); totalDocuments += Number(r.count); }
    if (r.type === "message") { entry.messages += Number(r.count); totalMessages += Number(r.count); }
    byMember.set(r.userId, entry);
  }

  return {
    subscriptionId: sub.id,
    creditsBalance: sub.creditsBalance,
    totalDocuments,
    totalMessages,
    totalCreditsConsumed: totalDocuments * DOCUMENT_COST + totalMessages * MESSAGE_COST,
    byMember: Array.from(byMember.values()),
  };
}

/** ملخص استهلاك كل المنظمات (لوحة تحكم الأدمن) */
export async function getAllOrgsUsageSummary() {
  const db = await getDb();
  if (!db) return [];
  const { sql, desc } = await import("drizzle-orm");
  const { users, organizations } = await import("../drizzle/schema");

  const rows = await db
    .select({
      subscriptionId: subscriptions.id,
      ownerUserId: subscriptions.userId,
      ownerName: users.name,
      ownerEmail: users.email,
      orgName: organizations.name,
      planNameAr: plans.nameAr,
      status: subscriptions.status,
      creditsBalance: subscriptions.creditsBalance,
      companyName: subscriptions.companyName,
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .leftJoin(organizations, eq(organizations.ownerId, subscriptions.userId))
    .orderBy(desc(subscriptions.createdAt));

  const usageRows = await db
    .select({
      subscriptionId: creditTransactions.subscriptionId,
      type: creditTransactions.type,
      count: sql<number>`count(*)`,
    })
    .from(creditTransactions)
    .where(sql`${creditTransactions.type} IN ('document', 'message')`)
    .groupBy(creditTransactions.subscriptionId, creditTransactions.type);

  const usageBySub = new Map<number, { documents: number; messages: number }>();
  for (const u of usageRows) {
    if (!u.subscriptionId) continue;
    const entry = usageBySub.get(u.subscriptionId) ?? { documents: 0, messages: 0 };
    if (u.type === "document") entry.documents += Number(u.count);
    if (u.type === "message") entry.messages += Number(u.count);
    usageBySub.set(u.subscriptionId, entry);
  }

  // ─── التوكنز الفعلية مقابل النقاط ──────────────────────────────────────────
  // llm_usage_log مسجَّل لكل مستخدم على حدة، بينما هذا الملخص لكل اشتراك.
  // لذلك نرفع استهلاك المستخدمين الفرعيين إلى مالك منظمتهم (صاحب الاشتراك).
  const { llmUsageLog } = await import("../drizzle/schema");
  const [tokenRows, allUsers, allOrgs] = await Promise.all([
    db.select({
      userId: llmUsageLog.userId,
      promptTokens: sql<number>`coalesce(sum(${llmUsageLog.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${llmUsageLog.completionTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${llmUsageLog.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    }).from(llmUsageLog).groupBy(llmUsageLog.userId),
    db.select({ id: users.id, organizationId: users.organizationId }).from(users),
    db.select({ id: organizations.id, ownerId: organizations.ownerId }).from(organizations),
  ]);

  // منظمات بلا مالك مسجّل تُتجاهل، ويُنسب استهلاك مستخدميها لأنفسهم
  const orgOwner = new Map<number, number>();
  for (const o of allOrgs) {
    if (o.ownerId != null) orgOwner.set(o.id, o.ownerId);
  }
  const userToOwner = new Map<number, number>(
    allUsers.map(u => [u.id, (u.organizationId != null ? orgOwner.get(u.organizationId) : undefined) ?? u.id]),
  );
  const subByOwner = new Map<number, number>(rows.map(r => [r.ownerUserId, r.subscriptionId]));

  type TokenAgg = { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; calls: number };
  const tokensBySub = new Map<number, TokenAgg>();
  for (const t of tokenRows) {
    // استدعاءات بلا userId (نظامية/مجدولة) لا تُنسب لأي عميل
    if (t.userId == null) continue;
    const ownerId = userToOwner.get(t.userId) ?? t.userId;
    const subId = subByOwner.get(ownerId);
    if (!subId) continue; // مستخدم بلا اشتراك (مثلاً أدمن المنصة) — لا يُنسب لأي عميل
    const e = tokensBySub.get(subId) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 };
    e.promptTokens += Number(t.promptTokens);
    e.completionTokens += Number(t.completionTokens);
    e.totalTokens += Number(t.totalTokens);
    e.costUsd += Number(t.costUsd);
    e.calls += Number(t.calls);
    tokensBySub.set(subId, e);
  }

  return rows.map(r => {
    const usage = usageBySub.get(r.subscriptionId) ?? { documents: 0, messages: 0 };
    const tk = tokensBySub.get(r.subscriptionId) ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 };
    const totalCreditsConsumed = usage.documents * DOCUMENT_COST + usage.messages * MESSAGE_COST;
    return {
      subscriptionId: r.subscriptionId,
      organizationName: r.orgName ?? r.companyName ?? r.ownerName ?? r.ownerEmail,
      ownerName: r.ownerName,
      ownerEmail: r.ownerEmail,
      planNameAr: r.planNameAr,
      status: r.status,
      creditsBalance: r.creditsBalance,
      totalDocuments: usage.documents,
      totalMessages: usage.messages,
      totalCreditsConsumed,
      // التوكنز الفعلية التي استهلكها هذا العميل مقابل النقاط أعلاه
      promptTokens: tk.promptTokens,
      completionTokens: tk.completionTokens,
      totalTokens: tk.totalTokens,
      llmCalls: tk.calls,
      llmCostUsd: Number(tk.costUsd.toFixed(6)),
      // متوسط التوكنز لكل نقطة — يوضح هل تسعير النقطة يغطي التكلفة الفعلية
      tokensPerCredit: totalCreditsConsumed > 0 ? Math.round(tk.totalTokens / totalCreditsConsumed) : 0,
    };
  });
}
