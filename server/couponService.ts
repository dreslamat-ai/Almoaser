// ─── خدمة الكوبونات ───────────────────────────────────────────────────────────
// الحساب نفسه في shared/coupons.ts ليستعمله السيرفر والواجهة معاً — الواجهة
// تُري العميل ما سيدفعه، والسيرفر يحصّله؛ فلو اختلفت الصيغتان لعرضنا سعراً
// غير الذي نأخذه.

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { coupons, couponRedemptions } from "../drizzle/schema";
import { applyCoupon, checkCoupon, normalizeCouponCode, type CouponScope } from "../shared/coupons";

export type ResolvedCoupon = {
  id: number;
  code: string;
  netBefore: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
};

/**
 * يتحقق من كوبون لعميل ومبلغ، ويعيد التفصيل — أو سبب الرفض بنص يُعرض كما هو.
 * لا يُسجّل شيئاً: يُستدعى للمعاينة قبل الدفع وللتحقق عند إنشائه.
 */
export async function resolveCoupon(params: {
  code: string;
  userId: number;
  scope: Exclude<CouponScope, "both">;
  netSar: number;
  planId?: number;
}): Promise<{ ok: true; coupon: ResolvedCoupon } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "تعذّر التحقق من الكوبون الآن" };

  const code = normalizeCouponCode(params.code);
  if (!code) return { ok: false, reason: "أدخل رمز الكوبون" };

  const rows = await db.select().from(coupons).where(eq(coupons.code, code)).limit(1);
  const row = rows[0];
  // نفس الرسالة للكود غير الموجود وغير الصالح: تمييزهما يكشف أي الأكواد حقيقي
  if (!row) return { ok: false, reason: "رمز الكوبون غير صحيح" };

  const check = checkCoupon(
    {
      type: row.type, value: Number(row.value), scope: row.scope,
      minAmountSar: row.minAmountSar == null ? null : Number(row.minAmountSar),
      maxUses: row.maxUses, usedCount: row.usedCount,
      validFrom: row.validFrom, validUntil: row.validUntil, isActive: row.isActive,
    },
    { scope: params.scope, netSar: params.netSar },
  );
  if (!check.ok) return { ok: false, reason: check.reason };

  // ─── الشروط الإضافية ────────────────────────────────────────────────────────
  if (row.planId != null && params.planId !== row.planId) {
    return { ok: false, reason: "هذا الكوبون لباقة أخرى" };
  }

  if (row.firstPurchaseOnly || row.newAccountWithinDays != null) {
    const { payments, users: usersTable } = await import("../drizzle/schema");
    if (row.firstPurchaseOnly) {
      // "عميل جديد" = لم يكتمل له دفع من قبل. المنح الإدارية لا تُحتسب شراءً.
      const [prior] = await db
        .select({ n: sql<number>`count(*)` })
        .from(payments)
        .where(and(
          eq(payments.userId, params.userId),
          eq(payments.status, "paid"),
          eq(payments.grantedByAdmin, false),
        ));
      if (Number(prior?.n ?? 0) > 0) return { ok: false, reason: "هذا الكوبون للعملاء الجدد فقط" };
    }
    if (row.newAccountWithinDays != null) {
      const [u] = await db
        .select({ createdAt: usersTable.createdAt })
        .from(usersTable)
        .where(eq(usersTable.id, params.userId))
        .limit(1);
      const ageDays = u ? (Date.now() - new Date(u.createdAt).getTime()) / 86_400_000 : Infinity;
      if (ageDays > row.newAccountWithinDays) {
        return { ok: false, reason: `هذا الكوبون للحسابات المُنشأة خلال ${row.newAccountWithinDays} يوماً من التسجيل` };
      }
    }
  }

  if (row.maxUsesPerUser != null) {
    const [used] = await db
      .select({ n: sql<number>`count(*)` })
      .from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, row.id), eq(couponRedemptions.userId, params.userId)));
    if (Number(used?.n ?? 0) >= row.maxUsesPerUser) {
      return { ok: false, reason: "استخدمت هذا الكوبون من قبل" };
    }
  }

  const calc = applyCoupon(params.netSar, { type: row.type, value: Number(row.value), scope: row.scope });
  return { ok: true, coupon: { id: row.id, code: row.code, ...calc } };
}

/**
 * يسجّل الاستخدام بعد إنشاء الدفعة.
 * العدّاد يُزاد بتعبير SQL لا بقراءة ثم كتابة: طلبان متزامنان بنفس الكوبون
 * كانا سيقرآن العدد نفسه ويكتبانه، فيمرّ استخدام بلا حساب.
 */
export async function recordRedemption(params: {
  couponId: number; userId: number; paymentId?: number; discountSar: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(couponRedemptions).values({
    couponId: params.couponId,
    userId: params.userId,
    paymentId: params.paymentId ?? null,
    discountSar: String(params.discountSar),
  });
  await db.update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(eq(coupons.id, params.couponId));
}

export async function listCoupons() {
  const db = await getDb();
  if (!db) return [];
  const { desc } = await import("drizzle-orm");
  return db.select().from(coupons).orderBy(desc(coupons.createdAt)).limit(200);
}

export async function createCoupon(input: {
  code: string; description?: string;
  type: "percent" | "fixed"; value: number; scope: CouponScope;
  minAmountSar?: number | null; maxUses?: number | null; maxUsesPerUser?: number | null;
  firstPurchaseOnly?: boolean; newAccountWithinDays?: number | null; planId?: number | null;
  validFrom?: Date | null; validUntil?: Date | null; createdBy: number;
}): Promise<{ ok: true; id: number } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "قاعدة البيانات غير متاحة" };
  const code = normalizeCouponCode(input.code);
  if (code.length < 3) return { ok: false, reason: "الرمز قصير جداً" };
  if (input.type === "percent" && (input.value <= 0 || input.value > 100)) {
    return { ok: false, reason: "النسبة يجب أن تكون بين 1 و100" };
  }
  if (input.type === "fixed" && input.value <= 0) return { ok: false, reason: "المبلغ يجب أن يكون أكبر من صفر" };

  const existing = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
  if (existing.length) return { ok: false, reason: "هذا الرمز مستخدم بالفعل" };

  const inserted = await db.insert(coupons).values({
    code, description: input.description?.slice(0, 255) ?? null,
    type: input.type, value: String(input.value), scope: input.scope,
    minAmountSar: input.minAmountSar == null ? null : String(input.minAmountSar),
    maxUses: input.maxUses ?? null, maxUsesPerUser: input.maxUsesPerUser ?? null,
    firstPurchaseOnly: input.firstPurchaseOnly ?? false,
    newAccountWithinDays: input.newAccountWithinDays ?? null,
    planId: input.planId ?? null,
    validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null,
    createdBy: input.createdBy,
  });
  return { ok: true, id: Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0) };
}

export async function setCouponActive(id: number, isActive: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(coupons).set({ isActive }).where(eq(coupons.id, id));
}
