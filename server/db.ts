import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, plans, subscriptions, tasks, serviceInvoices, registrationRequests, taskComments } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ─── Plans ───────────────────────────────────────────────────────────────────
export async function getActivePlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(plans).where(eq(plans.isActive, true));
}

export async function getPlanById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return result[0];
}

// ─── Subscriptions ────────────────────────────────────────────────────────────
export async function getSubscriptionByUserId(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return result[0];
}

export async function createSubscription(data: {
  userId: number;
  planId: number;
  companyName?: string;
  companyType?: string;
  phone?: string;
  vatNumber?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(subscriptions).values({
    userId: data.userId,
    planId: data.planId,
    status: "trial",
    companyName: data.companyName,
    companyType: data.companyType,
    phone: data.phone,
    vatNumber: data.vatNumber,
  });
}

export async function updateSubscription(id: number, data: Partial<typeof subscriptions.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(subscriptions).set(data).where(eq(subscriptions.id, id));
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
export async function getTasksByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.createdAt));
}

export async function createTask(data: {
  userId: number;
  subscriptionId?: number;
  title: string;
  description?: string;
  type: "bookkeeping" | "invoice" | "journal_entry" | "report" | "tax" | "payroll" | "other";
  priority?: "low" | "medium" | "high" | "urgent";
  dueDate?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(tasks).values({
    userId: data.userId,
    subscriptionId: data.subscriptionId,
    title: data.title,
    description: data.description,
    type: data.type,
    priority: data.priority ?? "medium",
    dueDate: data.dueDate,
    status: "pending",
  });
}

export async function updateTask(id: number, userId: number, data: Partial<typeof tasks.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(tasks).set(data).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
}

// ─── Service Invoices ─────────────────────────────────────────────────────────
export async function getInvoicesByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceInvoices).where(eq(serviceInvoices.userId, userId)).orderBy(desc(serviceInvoices.createdAt));
}

// ─── Registration Requests ────────────────────────────────────────────────────
export async function createRegistrationRequest(data: {
  name: string;
  email: string;
  phone: string;
  companyName?: string;
  companyType?: string;
  planId?: number;
  message?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(registrationRequests).values({
    name: data.name,
    email: data.email,
    phone: data.phone,
    companyName: data.companyName,
    companyType: data.companyType,
    planId: data.planId,
    message: data.message,
    status: "new",
  });
}

export async function getAllRegistrationRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(registrationRequests).orderBy(desc(registrationRequests.createdAt));
}

export async function getAllSubscriptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
}

export async function getAllTasks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

// ─── Task Comments ────────────────────────────────────────────────────────────
export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result[0];
}

export async function getTaskCommentsByTaskId(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      authorRole: taskComments.authorRole,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      authorName: users.name,
    })
    .from(taskComments)
    .leftJoin(users, eq(taskComments.userId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);
}

export async function createTaskComment(data: {
  taskId: number;
  userId: number;
  authorRole: "user" | "admin";
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(taskComments).values(data);
}

// ─── User Profile ─────────────────────────────────────────────────────────────
export async function updateUserProfile(userId: number, data: { name?: string; email?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set(data).where(eq(users.id, userId));
}

// ─── User Management (Admin) ──────────────────────────────────────────────────
export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      loginMethod: users.loginMethod,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
}

export async function setUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function setUserActive(userId: number, isActive: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ isActive }).where(eq(users.id, userId));
}
