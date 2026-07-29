/**
 * أدوات الأدمن لإدارة اشتراكات العملاء يدوياً: تفعيل بدون دفع، منح نقاط، تمديد
 * أيام، وعرض سجل المدفوعات/الفواتير لأي عميل — كلها إجراءات إدارية موثّقة
 * (تُسجَّل كحركة رصيد/دفعة بقيمة صفرية أو ملاحظة واضحة للتتبع).
 */
import { eq, desc } from "drizzle-orm";
import { getDb, getPlanById, getSubscriptionByUserId, updateSubscription, createSubscription } from "./db";
import { payments, serviceInvoices, creditTransactions, users } from "../drizzle/schema";
import { logAdminAction } from "./adminAudit";
import { topupPriceSAR, yearlyPrice } from "./credits";

async function getUserEmail(userId: number): Promise<string | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.email ?? undefined;
}

/** يفعّل اشتراكاً لعميل بدون أي عملية دفع فعلية — ينشئ الاشتراك إن لم يوجد. */
export async function activateSubscriptionWithoutPayment(params: {
  userId: number;
  planId: number;
  billing: "monthly" | "yearly";
  adminId: number;
  adminName?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const plan = await getPlanById(params.planId);
  if (!plan) throw new Error("الباقة غير موجودة");

  const periodMs = params.billing === "yearly" ? 365 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
  const endDate = new Date(Date.now() + periodMs);
  const monthlyPrice = Number(plan.price);
  const equivalentValue = params.billing === "yearly" ? yearlyPrice(monthlyPrice, plan.yearlyDiscountPct) : monthlyPrice;

  let sub = await getSubscriptionByUserId(params.userId);
  if (!sub) {
    await createSubscription({ userId: params.userId, planId: params.planId });
    sub = await getSubscriptionByUserId(params.userId);
  }
  if (!sub) throw new Error("تعذّر إنشاء الاشتراك");

  await updateSubscription(sub.id, {
    planId: params.planId,
    status: "active",
    billing: params.billing,
    endDate,
    creditsBalance: plan.monthlyCredits,
    creditsCycleStart: new Date(),
  });

  // سجل دفعة صفرية بغرض التوثيق فقط — يظهر في سجل المدفوعات كـ "منح إداري"
  await db.insert(payments).values({
    userId: params.userId,
    purpose: "subscription",
    planId: params.planId,
    billing: params.billing,
    amount: "0.00",
    status: "paid",
    paidAt: new Date(),
    invoiceId: `admin-grant-${Date.now()}`,
    grantedByAdmin: true,
    equivalentValue: String(equivalentValue.toFixed(2)),
  });

  await db.insert(creditTransactions).values({
    userId: params.userId,
    subscriptionId: sub.id,
    type: "adjustment",
    amount: plan.monthlyCredits,
    balanceAfter: plan.monthlyCredits,
    note: `تفعيل إداري لباقة ${plan.nameAr} بدون دفع${params.adminName ? ` — بواسطة ${params.adminName}` : ""}`,
  });

  await logAdminAction({
    adminId: params.adminId,
    adminName: params.adminName,
    action: "activate_subscription",
    targetUserId: params.userId,
    targetUserEmail: await getUserEmail(params.userId),
    details: `تفعيل باقة ${plan.nameAr} (${params.billing === "yearly" ? "سنوي" : "شهري"}) بدون دفع — قيمة مكافئة ${equivalentValue.toFixed(2)} ريال`,
  });
}

/** يمنح نقاط رصيد لعميل بدون دفع (منحة إدارية). */
export async function grantCreditsManual(params: { userId: number; credits: number; note?: string; adminId: number; adminName?: string }): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sub = await getSubscriptionByUserId(params.userId);
  if (!sub) throw new Error("لا يوجد اشتراك لهذا العميل");

  const newBalance = sub.creditsBalance + params.credits;
  const equivalentValue = topupPriceSAR(params.credits);
  await updateSubscription(sub.id, { creditsBalance: newBalance });
  await db.insert(creditTransactions).values({
    userId: params.userId,
    subscriptionId: sub.id,
    type: "adjustment",
    amount: params.credits,
    balanceAfter: newBalance,
    note: params.note || `منحة نقاط إدارية${params.adminName ? ` — بواسطة ${params.adminName}` : ""}`,
  });
  // سجل دفعة صفرية بغرض التوثيق فقط — تظهر في سجل مدفوعات العميل كـ "منحة نقاط"
  await db.insert(payments).values({
    userId: params.userId,
    purpose: "topup",
    credits: params.credits,
    amount: "0.00",
    status: "paid",
    paidAt: new Date(),
    invoiceId: `admin-grant-${Date.now()}`,
    grantedByAdmin: true,
    equivalentValue: String(equivalentValue.toFixed(2)),
  });

  await logAdminAction({
    adminId: params.adminId,
    adminName: params.adminName,
    action: "grant_credits",
    targetUserId: params.userId,
    targetUserEmail: await getUserEmail(params.userId),
    details: `منح ${params.credits} نقطة — قيمة مكافئة ${equivalentValue.toFixed(2)} ريال${params.note ? ` — ${params.note}` : ""}`,
  });
}

/** يمدّد اشتراك عميل بعدد أيام محدد خارج دورة الباقة العادية (لا يغيّر الرصيد/الباقة). */
export async function extendSubscriptionDays(params: { userId: number; days: number; note?: string; adminId: number; adminName?: string }): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sub = await getSubscriptionByUserId(params.userId);
  if (!sub) throw new Error("لا يوجد اشتراك لهذا العميل");

  const currentEnd = sub.endDate ? new Date(sub.endDate) : new Date();
  const base = currentEnd.getTime() > Date.now() ? currentEnd : new Date();
  const newEnd = new Date(base.getTime() + params.days * 24 * 3600 * 1000);

  const plan = await getPlanById(sub.planId);
  const equivalentValue = plan ? (Number(plan.price) / 30) * params.days : 0;

  await updateSubscription(sub.id, {
    endDate: newEnd,
    notes: [sub.notes, params.note || `تمديد إداري بـ ${params.days} يوماً`].filter(Boolean).join("\n"),
  });

  await db.insert(payments).values({
    userId: params.userId,
    purpose: "extension",
    planId: sub.planId,
    amount: "0.00",
    status: "paid",
    paidAt: new Date(),
    invoiceId: `admin-grant-${Date.now()}`,
    grantedByAdmin: true,
    equivalentValue: String(equivalentValue.toFixed(2)),
  });

  await logAdminAction({
    adminId: params.adminId,
    adminName: params.adminName,
    action: "extend_days",
    targetUserId: params.userId,
    targetUserEmail: await getUserEmail(params.userId),
    details: `تمديد ${params.days} يوماً — قيمة مكافئة ${equivalentValue.toFixed(2)} ريال${params.note ? ` — ${params.note}` : ""}`,
  });
}

/** سجل مدفوعات عميل محدد (لعرض الأدمن) */
export async function getPaymentsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(50);
}

/** فواتير خدمة عميل محدد (لعرض الأدمن) */
export async function getServiceInvoicesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceInvoices).where(eq(serviceInvoices.userId, userId)).orderBy(desc(serviceInvoices.createdAt)).limit(50);
}
