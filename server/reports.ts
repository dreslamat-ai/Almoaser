// ─── تقارير الوكيل الخبير ─────────────────────────────────────────────────────
// التقرير مستند له كيان: عنوان ونوع وتاريخ، يُفتح بعد شهور دون التنقيب في شات.
// كان يعيش كرسالة داخل المحادثة، فلا يمكن سرده ولا الرجوع إليه ولا تصديره.

import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { agentReports, users, organizations } from "../drizzle/schema";

export const REPORT_KINDS = [
  "system_assessment", "handover_terms", "contract_review",
  "policies", "workflow_design", "other",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  system_assessment: "تقييم نظام",
  handover_terms: "بنود استلام وتسليم",
  contract_review: "مراجعة تنفيذ عقد",
  policies: "سياسات وإجراءات",
  workflow_design: "تصميم دورة عمل",
  other: "تقرير",
};

export async function createReport(input: {
  userId: number;
  conversationId?: number | null;
  kind: ReportKind;
  title: string;
  content: string;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const inserted = await db.insert(agentReports).values({
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    kind: input.kind,
    title: input.title.slice(0, 255),
    content: input.content,
    // يبدأ منتظراً مراجعة العميل: التقرير مسوّدة حتى يقرّها صاحبه،
    // وهو ما تنصّ عليه قواعد وضع الخبير.
    status: "pending_review",
  });
  return Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0) || undefined;
}

/** تقارير عميل واحد (بلا المحتوى — للسرد) */
export async function listReportsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: agentReports.id, kind: agentReports.kind, title: agentReports.title,
      status: agentReports.status, createdAt: agentReports.createdAt,
      conversationId: agentReports.conversationId,
    })
    .from(agentReports)
    .where(eq(agentReports.userId, userId))
    .orderBy(desc(agentReports.createdAt))
    .limit(200);
}

export async function getReport(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(agentReports).where(eq(agentReports.id, id)).limit(1);
  return rows[0];
}

/** إقرار العميل للتقرير أو رفضه — المراجعة للعميل نفسه لا للمنصة */
export async function reviewReport(input: {
  id: number; userId: number; approve: boolean; note?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await getReport(input.id);
  // شرط الملكية هنا لا في الراوتر وحده: منع عميل من إقرار تقرير غيره
  if (!existing || existing.userId !== input.userId) return false;
  await db.update(agentReports)
    .set({
      status: input.approve ? "approved" : "rejected",
      reviewedAt: new Date(),
      reviewNote: input.note?.slice(0, 2000) ?? null,
    })
    .where(eq(agentReports.id, input.id));
  return true;
}

/** كل التقارير عبر الحسابات — لمالك المنصة */
export async function listAllReports() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: agentReports.id, kind: agentReports.kind, title: agentReports.title,
      status: agentReports.status, createdAt: agentReports.createdAt,
      ownerId: users.id, ownerName: users.name, ownerEmail: users.email,
      orgName: organizations.name,
    })
    .from(agentReports)
    .innerJoin(users, eq(agentReports.userId, users.id))
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .orderBy(desc(agentReports.createdAt))
    .limit(200);
}
