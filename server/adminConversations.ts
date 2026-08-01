// ─── اطّلاع مالك المنصة على محادثات العملاء ───────────────────────────────────
// للدعم ومراجعة الجودة ومتابعة ما ينفّذه الوكيل فعلاً لدى العملاء.
//
// القراءة هنا للعرض فقط: لا تُعدَّل محادثة ولا تُحذف. وكل فتح لمحادثة يُسجَّل في
// سجل التدقيق من طبقة الراوتر — بيانات العملاء مالية، والاطّلاع الذي لا يترك
// أثراً لا يمكن مراجعته ولا الدفاع عنه لاحقاً.

import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { agentConversations, agentMessages, users, organizations } from "../drizzle/schema";

export type AdminConversationRow = {
  id: number;
  title: string;
  updatedAt: Date;
  messageCount: number;
  ownerId: number;
  ownerName: string | null;
  ownerEmail: string | null;
  orgName: string | null;
};

/** قائمة المحادثات، اختيارياً لعميل بعينه. الأحدث أولاً. */
export async function listConversationsForAdmin(userId?: number): Promise<AdminConversationRow[]> {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      updatedAt: agentConversations.updatedAt,
      // العدّ في الاستعلام لا بجلب الرسائل: القائمة قد تشمل مئات المحادثات
      messageCount: sql<number>`(select count(*) from agent_messages m where m.conversationId = ${agentConversations.id})`,
      ownerId: users.id,
      ownerName: users.name,
      ownerEmail: users.email,
      orgName: organizations.name,
    })
    .from(agentConversations)
    .innerJoin(users, eq(agentConversations.userId, users.id))
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .orderBy(desc(agentConversations.updatedAt))
    .limit(200);

  const rows = userId ? await q.where(eq(agentConversations.userId, userId)) : await q;
  return rows.map(r => ({ ...r, messageCount: Number(r.messageCount) }));
}

/** محادثة واحدة برسائلها. يُرجع صاحبها ليُسجَّل الاطّلاع باسمه. */
export async function readConversationForAdmin(conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const convRows = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      createdAt: agentConversations.createdAt,
      updatedAt: agentConversations.updatedAt,
      ownerId: users.id,
      ownerName: users.name,
      ownerEmail: users.email,
      orgName: organizations.name,
    })
    .from(agentConversations)
    .innerJoin(users, eq(agentConversations.userId, users.id))
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(agentConversations.id, conversationId))
    .limit(1);

  const conv = convRows[0];
  if (!conv) return undefined;

  const messages = await db
    .select({
      id: agentMessages.id,
      role: agentMessages.role,
      content: agentMessages.content,
      createdAt: agentMessages.createdAt,
    })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(agentMessages.id);

  return {
    id: conv.id,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    owner: { id: conv.ownerId, name: conv.ownerName, email: conv.ownerEmail, orgName: conv.orgName },
    messages,
  };
}
