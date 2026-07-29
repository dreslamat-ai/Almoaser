import { eq, and, isNull, desc, sql } from "drizzle-orm";
import webpush from "web-push";
import { notifications, pushSubscriptions, users, type InsertNotification } from "../drizzle/schema";
import { getDb } from "./db";

import type { MySql2Database } from "drizzle-orm/mysql2";

async function requireDb(): Promise<MySql2Database> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db as unknown as MySql2Database;
}

// ─── إعداد VAPID ─────────────────────────────────────────────────────────────
let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VITE_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails("mailto:admin@almoaser.com", pub, priv);
  vapidConfigured = true;
  return true;
}

// ─── دوال قاعدة البيانات ─────────────────────────────────────────────────────
export async function listNotifications(userId: number, limit = 30) {
  const db = await requireDb();
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: number): Promise<number> {
  const db = await requireDb();
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(rows[0]?.c ?? 0);
}

export async function markRead(userId: number, id: number) {
  const db = await requireDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllRead(userId: number) {
  const db = await requireDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function deleteNotification(userId: number, id: number) {
  const db = await requireDb();
  await db
    .delete(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

// ─── اشتراكات Web Push ───────────────────────────────────────────────────────
export async function savePushSubscription(
  userId: number,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  const db = await requireDb();
  // إزالة أي صف قديم بنفس endpoint (قد يكون لمستخدم آخر على نفس الجهاز)
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
  });
}

export async function removePushSubscription(userId: number, endpoint: string) {
  const db = await requireDb();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

async function sendPushToUser(userId: number, payload: { title: string; body?: string; link?: string }) {
  if (!ensureVapid()) return;
  const db = await requireDb();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        // اشتراك منتهٍ/ملغى — ننظفه
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).catch(() => {});
        }
      }
    }),
  );
}

// ─── إنشاء إشعار (داخل الموقع + push) ───────────────────────────────────────
export async function notifyUser(input: {
  userId: number;
  type?: string;
  title: string;
  body?: string;
  link?: string;
  /** إرسال push للجهاز أيضاً (افتراضي: نعم) */
  push?: boolean;
}): Promise<number> {
  const db = await requireDb();
  const row: InsertNotification = {
    userId: input.userId,
    type: input.type ?? "general",
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  };
  const res = await db.insert(notifications).values(row);
  const insertId = (res as unknown as [{ insertId: number }])[0]?.insertId ?? 0;
  if (input.push !== false) {
    // لا ننتظر الإرسال حتى لا نبطئ الطلب الأصلي
    void sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      link: input.link,
    }).catch(() => {});
  }
  return Number(insertId);
}

// إشعار لجميع مستخدمي admin (مثل تسجيل مستخدم جديد)
export async function notifyAdmins(input: {
  type?: string;
  title: string;
  body?: string;
  link?: string;
}) {
  const db = await requireDb();
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  await Promise.all(
    admins.map((a) =>
      notifyUser({ userId: a.id, ...input }).catch(() => 0),
    ),
  );
}

// إشعار اقتراب انتهاء التجربة — يُستدعى عند جلب الاشتراك، مع منع التكرار اليومي
export async function maybeNotifyTrialEnding(
  userId: number,
  trialEndsAt: Date | null,
): Promise<void> {
  if (!trialEndsAt) return;
  const msLeft = trialEndsAt.getTime() - Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (msLeft <= 0 || msLeft > dayMs) return; // ننبه فقط في آخر 24 ساعة
  const db = await requireDb();
  // منع التكرار: لا نرسل إن وُجد إشعار trial_ending خلال آخر 24 ساعة
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "trial_ending"),
        sql`${notifications.createdAt} > (NOW() - INTERVAL 1 DAY)`,
      ),
    )
    .limit(1);
  if (recent.length > 0) return;
  const hoursLeft = Math.max(1, Math.round(msLeft / (60 * 60 * 1000)));
  await notifyUser({
    userId,
    type: "trial_ending",
    title: "فترتك التجريبية على وشك الانتهاء",
    body: `تبقى ${hoursLeft} ساعة تقريباً على انتهاء التجربة المجانية، وبعدها تُفعَّل باقتك تلقائياً.`,
    link: "/subscription",
  });
}

/** إشعار العميل باقتراب انتهاء اشتراكه (خارج التجربة) — يُستدعى من الفحص الدوري */
async function notifySubscriptionEnding(userId: number, daysLeft: number): Promise<void> {
  const db = await requireDb();
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, "subscription_ending"),
        sql`${notifications.createdAt} > (NOW() - INTERVAL 1 DAY)`,
      ),
    )
    .limit(1);
  if (recent.length > 0) return;
  await notifyUser({
    userId,
    type: "subscription_ending",
    title: "اشتراكك على وشك الانتهاء",
    body: `تبقّى ${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"} على انتهاء اشتراكك الحالي. جدّده الآن لتجنّب انقطاع الخدمة.`,
    link: "/subscription",
  });
}

/** إشعار كل الأدمن باقتراب انتهاء اشتراك ممنوح إدارياً (منحة مجانية) لمتابعته */
async function notifyAdminsGrantEnding(userId: number, ownerLabel: string, daysLeft: number): Promise<void> {
  const db = await requireDb();
  const recent = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.type, "admin_grant_ending"),
        sql`${notifications.body} LIKE ${`%user:${userId}%`}`,
        sql`${notifications.createdAt} > (NOW() - INTERVAL 1 DAY)`,
      ),
    )
    .limit(1);
  if (recent.length > 0) return;
  await notifyAdmins({
    type: "admin_grant_ending",
    title: "اشتراك ممنوح إدارياً على وشك الانتهاء",
    body: `اشتراك ${ownerLabel} (user:${userId}) الممنوح إدارياً بدون دفع سينتهي خلال ${daysLeft} ${daysLeft === 1 ? "يوم" : "أيام"} — راجع الحساب من لوحة الإدارة.`,
    link: "/admin",
  });
}

/**
 * فحص دوري لكل الاشتراكات القريبة من الانتهاء (٣ أيام أو أقل): تنبيه للعميل
 * دائماً، وتنبيه إضافي للأدمن إن كان الاشتراك ممنوحاً إدارياً بدون دفع.
 * يُستدعى من جدولة دورية (server/scheduler.ts) — كل استدعاء آمن للتكرار
 * (idempotent) بفضل فحص الإشعارات الأخيرة.
 */
export async function checkExpiringSubscriptions(): Promise<void> {
  const db = await requireDb();
  const { subscriptions, payments } = await import("../drizzle/schema");
  const { eq: eqOp, and: andOp, sql: sqlOp } = await import("drizzle-orm");

  const rows = await db
    .select({
      userId: subscriptions.userId,
      endDate: subscriptions.endDate,
      status: subscriptions.status,
      companyName: subscriptions.companyName,
      ownerName: users.name,
      ownerEmail: users.email,
    })
    .from(subscriptions)
    .innerJoin(users, eqOp(subscriptions.userId, users.id))
    .where(
      andOp(
        eqOp(subscriptions.status, "active"),
        sqlOp`${subscriptions.endDate} IS NOT NULL AND ${subscriptions.endDate} BETWEEN NOW() AND (NOW() + INTERVAL 3 DAY)`,
      ),
    );

  for (const r of rows) {
    if (!r.endDate) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(r.endDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    await notifySubscriptionEnding(r.userId, daysLeft).catch(() => {});

    const grantRows = await db
      .select({ id: payments.id })
      .from(payments)
      .where(andOp(eqOp(payments.userId, r.userId), eqOp(payments.grantedByAdmin, true)))
      .limit(1);
    if (grantRows.length > 0) {
      const label = r.companyName || r.ownerName || r.ownerEmail || `#${r.userId}`;
      await notifyAdminsGrantEnding(r.userId, label, daysLeft).catch(() => {});
    }
  }
}
