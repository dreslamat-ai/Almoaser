import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { users, notifications, pushSubscriptions } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  notifyUser,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  savePushSubscription,
  removePushSubscription,
} from "./notifications";

let userId: number;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("db unavailable");
  return db;
}

beforeAll(async () => {
  const db = await requireDb();
  const openId = `test-notif-${Date.now()}`;
  await db.insert(users).values({
    openId,
    name: "Notif Tester",
    email: `notif-${Date.now()}@test.local`,
    loginMethod: "test",
  });
  const [u] = await db.select().from(users).where(eq(users.openId, openId));
  userId = u.id;
});

afterAll(async () => {
  const db = await requireDb();
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

describe("notifications center", () => {
  it("creates and lists notifications with unread count", async () => {
    const id1 = await notifyUser({
      userId,
      type: "invoice_created",
      title: "فاتورة جديدة",
      body: "تم إنشاء الفاتورة ACC-SINV-2026-00001",
      push: false,
    });
    expect(id1).toBeGreaterThan(0);
    await notifyUser({
      userId,
      type: "task_completed",
      title: "مهمة مكتملة",
      body: "اكتملت مهمة المزامنة",
      push: false,
    });
    const list = await listNotifications(userId, 30);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].title).toBeTruthy();
    const count = await unreadCount(userId);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("marks a single notification as read", async () => {
    const list = await listNotifications(userId, 30);
    const target = list.find((n) => !n.readAt);
    expect(target).toBeTruthy();
    await markRead(userId, target!.id);
    const after = await listNotifications(userId, 30);
    expect(after.find((n) => n.id === target!.id)?.readAt).toBeTruthy();
  });

  it("marks all notifications as read", async () => {
    await markAllRead(userId);
    const count = await unreadCount(userId);
    expect(count).toBe(0);
  });

  it("deletes a notification and does not affect other users", async () => {
    const list = await listNotifications(userId, 30);
    const target = list[0];
    // deleting with a wrong user id must not delete
    await deleteNotification(userId + 999999, target.id);
    const still = await listNotifications(userId, 30);
    expect(still.some((n) => n.id === target.id)).toBe(true);
    // deleting with the right user works
    await deleteNotification(userId, target.id);
    const after = await listNotifications(userId, 30);
    expect(after.some((n) => n.id === target.id)).toBe(false);
  });
});

describe("push subscriptions", () => {
  const endpoint = `https://push.test.local/ep-${Date.now()}`;

  it("saves a push subscription (idempotent per endpoint)", async () => {
    await savePushSubscription(userId, {
      endpoint,
      keys: { p256dh: "test-p256dh", auth: "test-auth" },
    });
    await savePushSubscription(userId, {
      endpoint,
      keys: { p256dh: "test-p256dh-2", auth: "test-auth-2" },
    });
    const db = await requireDb();
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    const matching = subs.filter((s) => s.endpoint === endpoint);
    expect(matching.length).toBe(1);
    expect(matching[0].p256dh).toBe("test-p256dh-2");
  });

  it("removes a push subscription by endpoint", async () => {
    await removePushSubscription(userId, endpoint);
    const db = await requireDb();
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    expect(subs.some((s) => s.endpoint === endpoint)).toBe(false);
  });
});
