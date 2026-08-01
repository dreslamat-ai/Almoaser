// ─── كتالوج التطبيقات وطلباتها ────────────────────────────────────────────────
// الوكيل لا يبيع. حين يطلب عميل تطبيقاً — موجوداً كان أو لا — يُسجَّل الطلب
// ويُبلَّغ صاحب المنصة ليتولّى البيع بنفسه. المطابقة هنا اقتراح لا قرار: تُعرض
// على صاحب المنصة، ولا يُقال للعميل سعر ولا وعد بتسليم.

import { desc, eq, or, like, sql } from "drizzle-orm";
import { getDb } from "./db";
import { appCatalog, appRequests, users, organizations } from "../drizzle/schema";

/**
 * بحث نصّي بسيط في الكتالوج بالعربية والإنجليزية.
 * متعمَّد أن يكون فضفاضاً: نتيجة زائدة يراجعها صاحب المنصة أهون من طلب يمرّ
 * دون أن ينتبه أن عنده ما يلبّيه.
 */
export async function searchCatalog(query: string) {
  const db = await getDb();
  if (!db) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(w => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  const conditions = words.flatMap(w => [
    like(appCatalog.nameAr, `%${w}%`),
    like(appCatalog.name, `%${w}%`),
    like(appCatalog.description, `%${w}%`),
  ]);
  return db
    .select({
      id: appCatalog.id, name: appCatalog.name, nameAr: appCatalog.nameAr,
      description: appCatalog.description, erpTarget: appCatalog.erpTarget,
      status: appCatalog.status, version: appCatalog.version,
    })
    .from(appCatalog)
    .where(or(...conditions))
    .limit(10);
}

export async function recordAppRequest(input: {
  userId: number; requestText: string; matchedAppId?: number | null;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const inserted = await db.insert(appRequests).values({
    userId: input.userId,
    requestText: input.requestText.slice(0, 4000),
    matchedAppId: input.matchedAppId ?? null,
  });
  return Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0) || undefined;
}

export async function listAppRequests() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: appRequests.id, requestText: appRequests.requestText, status: appRequests.status,
      matchedAppId: appRequests.matchedAppId, ownerNote: appRequests.ownerNote,
      createdAt: appRequests.createdAt,
      ownerName: users.name, ownerEmail: users.email, orgName: organizations.name,
      matchedAppNameAr: appCatalog.nameAr,
    })
    .from(appRequests)
    .innerJoin(users, eq(appRequests.userId, users.id))
    .leftJoin(organizations, eq(users.organizationId, organizations.id))
    .leftJoin(appCatalog, eq(appRequests.matchedAppId, appCatalog.id))
    .orderBy(desc(appRequests.createdAt))
    .limit(200);
}

export async function setRequestStatus(id: number, status: "new" | "contacted" | "sold" | "declined", note?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(appRequests)
    .set({ status, ownerNote: note?.slice(0, 2000) ?? null })
    .where(eq(appRequests.id, id));
}

export async function listCatalog() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appCatalog).orderBy(desc(appCatalog.updatedAt)).limit(200);
}

export async function upsertCatalogApp(input: {
  id?: number;
  name: string; nameAr: string; description?: string | null;
  erpTarget: "erpnext" | "odoo" | "both";
  status: "available" | "in_development" | "planned";
  priceSar?: number | null; repoUrl?: string | null; version?: string | null;
  parentAppId?: number | null; changesSummary?: string | null;
}): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const values = {
    name: input.name.slice(0, 120), nameAr: input.nameAr.slice(0, 160),
    description: input.description ?? null, erpTarget: input.erpTarget, status: input.status,
    priceSar: input.priceSar == null ? null : String(input.priceSar),
    repoUrl: input.repoUrl ?? null, version: input.version ?? "1.0.0",
    parentAppId: input.parentAppId ?? null, changesSummary: input.changesSummary ?? null,
  };
  if (input.id) {
    await db.update(appCatalog).set(values).where(eq(appCatalog.id, input.id));
    return input.id;
  }
  const inserted = await db.insert(appCatalog).values(values);
  return Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0) || undefined;
}

/** عدد الطلبات غير المعالَجة — لتنبيه صاحب المنصة */
export async function countNewRequests(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(appRequests).where(eq(appRequests.status, "new"));
  return Number(r?.n ?? 0);
}
