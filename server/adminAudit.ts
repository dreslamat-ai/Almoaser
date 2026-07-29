// ─── سجل تدقيق إجراءات الأدمن ─────────────────────────────────────────────────
import { desc } from "drizzle-orm";
import { getDb } from "./db";
import { adminActionLog } from "../drizzle/schema";

export type AdminActionType =
  | "activate_subscription" | "set_subscription_status" | "grant_credits"
  | "extend_days" | "set_user_role" | "set_user_active";

/** يسجّل إجراءً إدارياً حساساً — لا يوقف تنفيذ الإجراء نفسه عند فشل التسجيل. */
export async function logAdminAction(params: {
  adminId: number;
  adminName?: string;
  action: AdminActionType;
  targetUserId: number;
  targetUserEmail?: string;
  details?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(adminActionLog).values({
      adminId: params.adminId,
      adminName: params.adminName,
      action: params.action,
      targetUserId: params.targetUserId,
      targetUserEmail: params.targetUserEmail,
      details: params.details,
    });
  } catch (e) {
    console.warn("[adminAudit] failed to log action:", e instanceof Error ? e.message : e);
  }
}

/** سجل التدقيق الكامل (آخر N إجراء) — لعرض الأدمن */
export async function getAdminActionLog(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(adminActionLog).orderBy(desc(adminActionLog.createdAt)).limit(limit);
}
