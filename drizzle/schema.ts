import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const plans = mysqlTable("plans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  nameAr: varchar("nameAr", { length: 100 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("SAR").notNull(),
  billingCycle: mysqlEnum("billingCycle", ["monthly", "yearly"]).default("monthly").notNull(),
  maxTasks: int("maxTasks").default(10).notNull(),
  maxTransactions: int("maxTransactions").default(100).notNull(),
  // حد المستندات الشهري (30 / 50 / 100)
  maxDocuments: int("maxDocuments").default(30).notNull(),
  // رصيد النقاط الشهري = maxDocuments × 5 (رسالة = 1 نقطة، مستند = 5 نقاط)
  monthlyCredits: int("monthlyCredits").default(150).notNull(),
  // نسبة خصم الدفع السنوي بالمئة (15% لجميع الباقات)
  yearlyDiscountPct: int("yearlyDiscountPct").default(15).notNull(),
  // هل تشمل الباقة دعماً شخصياً مباشراً
  hasDirectSupport: boolean("hasDirectSupport").default(false).notNull(),
  features: text("features"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  planId: int("planId").notNull().references(() => plans.id),
  status: mysqlEnum("status", ["active", "inactive", "cancelled", "trial"]).default("trial").notNull(),
  startDate: timestamp("startDate").defaultNow().notNull(),
  endDate: timestamp("endDate"),
  // دورة الفوترة المختارة: شهري أو سنوي (بخصم 15%)
  billing: mysqlEnum("billing", ["monthly", "yearly"]).default("monthly").notNull(),
  // رصيد النقاط المتبقي (يُعاد تعبئته شهرياً من الباقة + يُضاف إليه الشحن)
  creditsBalance: int("creditsBalance").default(0).notNull(),
  // بداية الدورة الشهرية الحالية للنقاط (تُجدَّد كل 30 يوماً)
  creditsCycleStart: timestamp("creditsCycleStart"),
  companyName: varchar("companyName", { length: 255 }),
  companyType: varchar("companyType", { length: 100 }),
  phone: varchar("phone", { length: 20 }),
  vatNumber: varchar("vatNumber", { length: 50 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── حركات النقاط (خصم/شحن/تجديد) ────────────────────────────────────────────
export const creditTransactions = mysqlTable("credit_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  subscriptionId: int("subscriptionId").references(() => subscriptions.id),
  // النوع: message (رسالة -1) | document (مستند -5) | monthly_refill (تعبئة شهرية) | topup (شحن مدفوع) | adjustment (تعديل إداري)
  type: mysqlEnum("type", ["message", "document", "monthly_refill", "topup", "adjustment"]).notNull(),
  // موجبة للإضافة وسالبة للخصم
  amount: int("amount").notNull(),
  // الرصيد بعد الحركة
  balanceAfter: int("balanceAfter").notNull(),
  note: varchar("note", { length: 300 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── مدفوعات MyFatoorah ───────────────────────────────────────────────────────
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  // الغرض: subscription (اشتراك/ترقية) | topup (شحن نقاط)
  purpose: mysqlEnum("purpose", ["subscription", "topup"]).notNull(),
  planId: int("planId").references(() => plans.id),
  // دورة الفوترة عند الاشتراك
  billing: mysqlEnum("billing", ["monthly", "yearly"]),
  // عدد النقاط عند الشحن
  credits: int("credits"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("SAR").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "failed", "expired"]).default("pending").notNull(),
  // معرف الفاتورة لدى MyFatoorah
  invoiceId: varchar("invoiceId", { length: 100 }),
  paymentUrl: varchar("paymentUrl", { length: 500 }),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  subscriptionId: int("subscriptionId").references(() => subscriptions.id),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["bookkeeping", "invoice", "journal_entry", "report", "tax", "payroll", "other"]).default("bookkeeping").notNull(),
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "cancelled"]).default("pending").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  dueDate: timestamp("dueDate"),
  completedAt: timestamp("completedAt"),
  attachmentUrl: text("attachmentUrl"),
  agentNotes: text("agentNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const serviceInvoices = mysqlTable("service_invoices", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  subscriptionId: int("subscriptionId").references(() => subscriptions.id),
  invoiceNumber: varchar("invoiceNumber", { length: 50 }).notNull().unique(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("SAR").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "overdue", "cancelled"]).default("pending").notNull(),
  dueDate: timestamp("dueDate"),
  paidAt: timestamp("paidAt"),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const registrationRequests = mysqlTable("registration_requests", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  companyName: varchar("companyName", { length: 255 }),
  companyType: varchar("companyType", { length: 100 }),
  businessSector: varchar("businessSector", { length: 150 }),
  planId: int("planId").references(() => plans.id),
  message: text("message"),
  status: mysqlEnum("status", ["new", "contacted", "converted", "rejected"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const taskComments = mysqlTable("task_comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull().references(() => tasks.id),
  userId: int("userId").notNull().references(() => users.id),
  authorRole: mysqlEnum("authorRole", ["user", "admin"]).default("user").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── اتصالات ERPNext لكل مستخدم ───────────────────────────────────────────────
// كل عميل يسجّل رابط نظامه واسم المستخدم وكلمة المرور من صفحة الإعدادات،
// ويعمل الوكيل وجميع استدعاءات ERPNext على نظامه هو (fallback لاتصال المالك الافتراضي)
export const erpnextConnections = mysqlTable("erpnext_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  url: varchar("url", { length: 500 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  // كلمة المرور مشفرة AES-256-GCM (iv:tag:ciphertext) بمفتاح مشتق من JWT_SECRET
  passwordEnc: text("passwordEnc").notNull(),
  lastVerifiedAt: timestamp("lastVerifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// ─── سجل محادثات الوكيل الذكي ─────────────────────────────────────────────────
// كل محادثة مرتبطة بمستخدم، والرسائل (user/assistant) تُحفظ تلقائياً أثناء agent.chat
export const agentConversations = mysqlTable("agent_conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  title: varchar("title", { length: 255 }).default("محادثة جديدة").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const agentMessages = mysqlTable("agent_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => agentConversations.id),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  // نتائج الأدوات (جداول الفواتير/العملاء/التقارير) محفوظة JSON لإعادة عرضها عند فتح المحادثة
  toolResults: text("toolResults"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type ServiceInvoice = typeof serviceInvoices.$inferSelect;
export type RegistrationRequest = typeof registrationRequests.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
export type ErpnextConnection = typeof erpnextConnections.$inferSelect;
export type AgentConversation = typeof agentConversations.$inferSelect;
export type AgentMessage = typeof agentMessages.$inferSelect;

// ─── نظام الإشعارات المخصصة ──────────────────────────────────────────────────
// إشعارات المستخدم داخل الموقع (مركز الإشعارات — جرس + عدّاد غير المقروء)
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  // نوع الحدث: invoice_created | invoice_submitted | task_completed | trial_ending | new_user | general
  type: varchar("type", { length: 40 }).default("general").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  // رابط داخلي يُفتح عند النقر مثل /erp/invoices
  link: varchar("link", { length: 300 }),
  // وقت القراءة، null = غير مقروء
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// اشتراكات Web Push لأجهزة المستخدمين (جهاز/متصفح لكل صف)
export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  endpoint: varchar("endpoint", { length: 500 }).notNull(),
  p256dh: varchar("p256dh", { length: 200 }).notNull(),
  auth: varchar("auth", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
