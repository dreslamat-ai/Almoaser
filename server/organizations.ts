/**
 * إدارة المنظمات (حسابات الشركات): مالك + مستخدمون فرعيون بصلاحيات محددة.
 * كل الاشتراك/الرصيد/اتصال ERPNext مرتبط بحساب المالك (owner) — المستخدمون الفرعيون
 * يستخدمون نفس البيانات عبر resolveOrgOwnerId، ولهم صلاحياتهم الخاصة داخل أدوات الوكيل.
 */
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { users, organizations, DEFAULT_MEMBER_PERMISSIONS, type MemberPermissions, type User } from "../drizzle/schema";
import { hashPassword, verifyPassword } from "./password";

/** يتحقق أن المستخدم (مالك أو مستخدم فرعي بالصلاحية المطلوبة) يملك حق تنفيذ عملية معينة. */
export function requireMemberPermission(user: User, permission: keyof MemberPermissions): void {
  if (user.orgRole === "owner") return;
  const perms = parsePermissions(user.permissions);
  if (!perms[permission]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "ليس لديك صلاحية لتنفيذ هذا الإجراء — تواصل مع مدير الحساب" });
  }
}

export function parsePermissions(raw: string | null | undefined): MemberPermissions {
  if (!raw) return DEFAULT_MEMBER_PERMISSIONS;
  try {
    return { ...DEFAULT_MEMBER_PERMISSIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_MEMBER_PERMISSIONS;
  }
}

/** ينشئ منظمة جديدة لمستخدم (مالك) لا ينتمي لأي منظمة بعد، ويربطه بها. */
export async function ensureOrganizationForOwner(user: User, orgName?: string): Promise<number> {
  if (user.organizationId) return user.organizationId;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(organizations).values({
    name: orgName ?? user.name ?? user.email ?? `منظمة #${user.id}`,
    ownerId: user.id,
  });
  const organizationId = Number((result as unknown as [{ insertId: number }])[0].insertId);

  await db.update(users)
    .set({ organizationId, orgRole: "owner" })
    .where(eq(users.id, user.id));

  return organizationId;
}

/**
 * يرجع الـ userId الذي يجب استخدام بياناته الفعلية (اشتراك/اتصال ERPNext):
 * صاحب الحساب نفسه إن كان مالكاً، أو مالك منظمته إن كان مستخدماً فرعياً.
 * ينشئ منظمة تلقائياً للحسابات القديمة (قبل نظام المنظمات) عند أول استخدام.
 */
export async function resolveOrgOwnerId(user: User): Promise<number> {
  if (user.orgRole === "owner" || !user.organizationId) {
    await ensureOrganizationForOwner(user);
    return user.id;
  }
  const db = await getDb();
  if (!db) return user.id;
  const rows = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  return rows[0]?.ownerId ?? user.id;
}

export async function getOrganizationForUser(user: User) {
  const db = await getDb();
  if (!db) return undefined;
  const orgId = user.organizationId ?? (await ensureOrganizationForOwner(user));
  const rows = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return rows[0];
}

export async function listOrgMembers(organizationId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    orgRole: users.orgRole,
    permissions: users.permissions,
    isActive: users.isActive,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).where(eq(users.organizationId, organizationId));

  return rows.map(r => ({ ...r, permissions: parsePermissions(r.permissions) }));
}

/** يضيف مستخدماً فرعياً جديداً لمنظمة، بكلمة مرور محلية وصلاحيات محددة. */
export async function inviteSubUser(params: {
  organizationId: number;
  name: string;
  email: string;
  password: string;
  permissions?: Partial<MemberPermissions>;
}): Promise<{ ok: true; userId: number } | { ok: false; error: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "تعذّر الاتصال بقاعدة البيانات" };

  const normalizedEmail = params.email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existing[0]) return { ok: false, error: "يوجد مستخدم بهذا البريد الإلكتروني بالفعل" };

  const openId = `member:${crypto.randomUUID()}`;
  const permissions = JSON.stringify({ ...DEFAULT_MEMBER_PERMISSIONS, ...(params.permissions ?? {}) });

  const result = await db.insert(users).values({
    openId,
    name: params.name,
    email: normalizedEmail,
    loginMethod: "password",
    organizationId: params.organizationId,
    orgRole: "member",
    permissions,
    passwordHash: hashPassword(params.password),
  });
  const userId = Number((result as unknown as [{ insertId: number }])[0].insertId);
  return { ok: true, userId };
}

export async function updateMemberPermissions(
  memberId: number,
  organizationId: number,
  permissions: Partial<MemberPermissions>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(users).where(and(eq(users.id, memberId), eq(users.organizationId, organizationId))).limit(1);
  const member = rows[0];
  if (!member || member.orgRole !== "member") throw new Error("المستخدم الفرعي غير موجود في هذه المنظمة");
  const merged = { ...parsePermissions(member.permissions), ...permissions };
  await db.update(users).set({ permissions: JSON.stringify(merged) }).where(eq(users.id, memberId));
}

export async function removeMember(memberId: number, organizationId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(users).where(and(eq(users.id, memberId), eq(users.organizationId, organizationId))).limit(1);
  const member = rows[0];
  if (!member || member.orgRole !== "member") throw new Error("المستخدم الفرعي غير موجود في هذه المنظمة");
  await db.update(users).set({ isActive: false }).where(eq(users.id, memberId));
}

/** تسجيل دخول مستخدم فرعي بكلمة المرور المحلية (لا علاقة له بـ ERPNext مباشرة). */
export async function loginSubUserWithPassword(
  email: string,
  password: string
): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const db = await getDb();
  if (!db) return { ok: false, error: "تعذّر الاتصال بقاعدة البيانات" };
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  const user = rows[0];
  if (!user || !user.passwordHash) return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  if (!user.isActive) return { ok: false, error: "تم تعطيل حسابك. يرجى التواصل مع مدير الحساب" };
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  return { ok: true, user };
}
