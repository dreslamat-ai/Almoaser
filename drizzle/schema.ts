import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean } from "drizzle-orm/mysql-core";

// ─── المنظمات (حساب الشركة) ───────────────────────────────────────────────────
// كل حساب عميل هو "منظمة" واحدة: مالك (owner) واحد + مستخدمون فرعيون (members)
// يشاركون نفس الاشتراك/الرصيد/اتصال ERPNext، كل واحد له صلاحياته الخاصة
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  ownerId: int("ownerId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;

// صلاحيات المستخدم الفرعي داخل المنظمة — كل حقل true/false لتفعيل قدرة معينة
export type MemberPermissions = {
  viewInvoices: boolean;
  createInvoices: boolean;
  managePayments: boolean;
  manageErpSettings: boolean;
  manageJournalEntries: boolean;
};

export const DEFAULT_MEMBER_PERMISSIONS: MemberPermissions = {
  viewInvoices: true,
  createInvoices: true,
  managePayments: false,
  manageErpSettings: false,
  manageJournalEntries: false,
};

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  // دور على مستوى المنصة (admin = موظف المعاصر) — لا علاقة له بدور المستخدم داخل منظمته
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // المنظمة التي ينتمي إليها المستخدم (null مؤقتاً لحسابات ما قبل الترحيل)
  organizationId: int("organizationId"),
  // دور المستخدم داخل منظمته: owner (مالك الحساب، كل الصلاحيات) أو member (مستخدم فرعي بصلاحيات محددة)
  orgRole: mysqlEnum("orgRole", ["owner", "member"]).default("owner").notNull(),
  // صلاحيات المستخدم الفرعي (JSON من MemberPermissions) — تُتجاهل لو orgRole = owner
  permissions: text("permissions"),
  // كلمة مرور محلية (scrypt) — للمستخدمين الفرعيين فقط، الذين ليس لهم حساب ERPNext خاص بهم
  passwordHash: text("passwordHash"),
  // تاريخ تأكيد البريد الإلكتروني (null = غير مؤكد بعد)
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  // رقم الجوال بصيغة E.164 (‎+9665XXXXXXXX) — يُطلب عند التسجيل
  phone: varchar("phone", { length: 20 }),
  // تاريخ تأكيد الجوال (null = غير مؤكد). التأكيد مؤجَّل لا مُتخطّى:
  // لو تعذّر الإرسال يدخل العميل ويظل التذكير ظاهراً حتى يتأكد فعلياً.
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  // تفضيل استلام الإشعارات والتذكيرات على البريد
  emailNotifications: boolean("emailNotifications").default(true).notNull(),
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
  // وضع الوكيل: accounting = محاسب ينفّذ الحركات (الافتراضي)،
  // expert = مستشار تطبيق ERPNext/Odoo يقيّم ويضبط الإعدادات ولا يُدخل أي حركة
  mode: mysqlEnum("mode", ["accounting", "expert"]).default("accounting").notNull(),
  features: text("features"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  planId: int("planId").notNull().references(() => plans.id),
  // السعر المتفق عليه وقت الاشتراك — التجديد يُحاسَب عليه لا على جدول اليوم.
  // بدونه يُعاد تسعير مشترك قائم لمجرّد أنه سافر أو تغيّر عنوانه.
  priceAtPurchase: decimal("priceAtPurchase", { precision: 10, scale: 2 }),
  currencyAtPurchase: varchar("currencyAtPurchase", { length: 3 }),
  marketAtPurchase: varchar("marketAtPurchase", { length: 2 }),
  status: mysqlEnum("status", ["active", "inactive", "cancelled", "trial"]).default("trial").notNull(),
  startDate: timestamp("startDate").defaultNow().notNull(),
  endDate: timestamp("endDate"),
  // دورة الفوترة المختارة: شهري أو سنوي (بخصم 15%)
  billing: mysqlEnum("billing", ["monthly", "yearly"]).default("monthly").notNull(),
  // رصيد النقاط المتبقي (يُعاد تعبئته شهرياً من الباقة + يُضاف إليه الشحن)
  creditsBalance: int("creditsBalance").default(0).notNull(),
  // بداية الدورة الشهرية الحالية للنقاط (تُجدَّد كل 30 يوماً)
  creditsCycleStart: timestamp("creditsCycleStart"),
  // رصيد مفتوح: لا يُخصم ولا يمنع، لكن الاستهلاك يُسجَّل كاملاً — للحسابات
  // الداخلية التي نريد قياس استخدامها دون أن يوقفها حدّ.
  unlimitedCredits: boolean("unlimitedCredits").default(false).notNull(),
  companyName: varchar("companyName", { length: 255 }),
  companyType: varchar("companyType", { length: 100 }),
  phone: varchar("phone", { length: 20 }),
  vatNumber: varchar("vatNumber", { length: 50 }),
  // العنوان الوطني ورقم السجل — تُقرأ من شهادة التسجيل الضريبي وتلزم الفاتورة
  companyAddress: varchar("companyAddress", { length: 400 }),
  crNumber: varchar("crNumber", { length: 30 }),
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
  // الغرض: subscription (اشتراك/ترقية) | topup (شحن نقاط) | extension (تمديد أيام إداري)
  purpose: mysqlEnum("purpose", ["subscription", "topup", "extension"]).notNull(),
  planId: int("planId").references(() => plans.id),
  // دورة الفوترة عند الاشتراك
  billing: mysqlEnum("billing", ["monthly", "yearly"]),
  // عدد النقاط عند الشحن
  credits: int("credits"),
  // المبلغ المحصَّل فعلاً شاملاً الضريبة — هو ما يُطابق كشف بوابة الدفع
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  // ضريبة القيمة المضافة داخل amount. تبقى null للصفوف القديمة السابقة لتطبيق
  // الضريبة، فيحسبها تقرير الإيرادات صفراً ولا تتغيّر أرقام الماضي بأثر رجعي.
  vatAmount: decimal("vatAmount", { precision: 10, scale: 2 }),
  // الكوبون المستخدم والخصم الفعلي — بدونهما لا يُعرف سبب تحصيل مبلغ أقل من السعر
  couponId: int("couponId"),
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }).default("SAR").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "failed", "expired"]).default("pending").notNull(),
  // معرف الفاتورة لدى MyFatoorah
  invoiceId: varchar("invoiceId", { length: 100 }),
  paymentUrl: varchar("paymentUrl", { length: 500 }),
  paidAt: timestamp("paidAt"),
  // true = منحة إدارية (بدون تحصيل فعلي) — amount تبقى 0.00 وتُستخدم equivalentValue لحساب "القيمة الممنوحة"
  grantedByAdmin: boolean("grantedByAdmin").default(false).notNull(),
  // القيمة السوقية المكافئة للمنحة الإدارية (ريال) — لأغراض تقرير الإيرادات فقط، لا تُحصَّل فعلياً
  equivalentValue: decimal("equivalentValue", { precision: 10, scale: 2 }),
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

// ─── اتصالات نظام ERP لكل منظمة (مالك الحساب) ─────────────────────────────────
// كل عميل يسجّل نوع نظامه (ERPNext أو Odoo) ورابطه وبيانات اعتماده من صفحة الإعدادات،
// ويعمل الوكيل وجميع استدعاءات ERP عبر ErpAdapter المناسب لنظامه (fallback لاتصال المالك الافتراضي)
export const erpnextConnections = mysqlTable("erpnext_connections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  // نوع نظام ERP: erpnext (افتراضي، للاتصالات القديمة قبل دعم تعدد الأنظمة) أو odoo
  provider: mysqlEnum("provider", ["erpnext", "odoo"]).default("erpnext").notNull(),
  url: varchar("url", { length: 500 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  // كلمة المرور مشفرة AES-256-GCM (iv:tag:ciphertext) بمفتاح مشتق من JWT_SECRET
  passwordEnc: text("passwordEnc").notNull(),
  // اسم قاعدة البيانات — مطلوب لـ Odoo فقط (ERPNext لا يحتاجه)
  database: varchar("database", { length: 100 }),
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
// ─── عملاء محتملون من شات المبيعات ───────────────────────────────────────────
// الشات مفتوح بلا بوابة عمداً: الزائر الذي يسأل عن السعر يهرب من استمارة قبل
// الكلام، فنخسر المحادثة والبيانات معاً — كما أن إرسال رسائل تحقّق لزائر مجهول
// باب استنزاف مكلف. سارة تجمع البيانات حين يظهر الاهتمام، وقتها يعطيها العميل
// بيانات صحيحة لأنه يريد شيئاً. التحقق بالرسالة يبقى في مكانه الطبيعي: التسجيل.
// الرقم بصيغة E.164 موحّدة كي لا يظهر العميل الواحد مرتين.
export const salesLeads = mysqlTable("sales_leads", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 20 }).unique(),
  phoneVerifiedAt: timestamp("phoneVerifiedAt"),
  // تُستكمل أثناء المحادثة
  city: varchar("city", { length: 120 }),
  activity: varchar("activity", { length: 255 }),
  employees: int("employees"),
  interestedPlanId: int("interestedPlanId"),
  // نص المحادثة الأخير للسياق عند المتابعة البشرية
  notes: text("notes"),
  status: mysqlEnum("status", ["new", "contacted", "converted", "declined"]).default("new").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SalesLead = typeof salesLeads.$inferSelect;

// ─── أسعار الباقات حسب السوق ─────────────────────────────────────────────────
// السعر بيانات لا معادلة: فتح سوق صفٌّ يُضاف لا إصدار يُنشر. والنسبة الضريبية
// مع الصف كي يكون تغييرها لسوق ما تعديلَ بيانات.
export const planPrices = mysqlTable("plan_prices", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull().references(() => plans.id),
  market: varchar("market", { length: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  vatRatePct: decimal("vatRatePct", { precision: 5, scale: 2 }).default("15.00").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlanPrice = typeof planPrices.$inferSelect;

// ─── كتالوج التطبيقات التي بناها الوكيل ──────────────────────────────────────
// شغل الوكيل أصل يُعاد بيعه لا مهمة تنتهي: تطبيق بُني لعميل يصلح لغيره. ولأن
// النسخة اللاحقة تُبنى فوق سابقة، نحفظ نسبها والفرق بينهما — بلا ذلك لا يُعرف
// بعد سنة ما الذي يميّز نسخة عن أخرى ولا أيّهما تُعرض على عميل جديد.
export const appCatalog = mysqlTable("app_catalog", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  nameAr: varchar("nameAr", { length: 160 }).notNull(),
  description: text("description"),
  erpTarget: mysqlEnum("erpTarget", ["erpnext", "odoo", "both"]).default("erpnext").notNull(),
  status: mysqlEnum("status", ["available", "in_development", "planned"]).default("planned").notNull(),
  priceSar: decimal("priceSar", { precision: 10, scale: 2 }),
  repoUrl: varchar("repoUrl", { length: 300 }),
  version: varchar("version", { length: 40 }).default("1.0.0"),
  // النسخة التي اشتُقّت منها هذه، وما الذي تغيّر
  parentAppId: int("parentAppId"),
  changesSummary: text("changesSummary"),
  // العميل الذي بُنيت له أصلاً (للعلم لا للتقييد)
  builtForUserId: int("builtForUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// طلبات العملاء للتطبيقات — سواء طابقت الكتالوج أم لا. غير المطابق أثمن:
// يقول ما يطلبه السوق ولم يُبنَ بعد.
export const appRequests = mysqlTable("app_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  requestText: text("requestText").notNull(),
  matchedAppId: int("matchedAppId"),
  status: mysqlEnum("status", ["new", "contacted", "sold", "declined"]).default("new").notNull(),
  ownerNote: text("ownerNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatalogApp = typeof appCatalog.$inferSelect;

// ─── كوبونات الخصم ───────────────────────────────────────────────────────────
// الخصم يقع على المبلغ قبل الضريبة (راجع shared/coupons.ts). ويُسجَّل كل استخدام
// في جدول مستقل: عدّاد وحده لا يقول من استخدم ولا بكم، وهو ما يُسأل عنه لاحقاً.
export const coupons = mysqlTable("coupons", {
  id: int("id").autoincrement().primaryKey(),
  // يُخزَّن بحروف كبيرة بلا مسافات — التوحيد في shared/coupons.ts
  code: varchar("code", { length: 40 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  type: mysqlEnum("type", ["percent", "fixed"]).notNull(),
  // نسبة مئوية أو مبلغ بالريال حسب النوع
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  scope: mysqlEnum("scope", ["subscription", "topup", "both"]).default("both").notNull(),
  minAmountSar: decimal("minAmountSar", { precision: 10, scale: 2 }),
  // null = بلا حد لعدد الاستخدامات
  maxUses: int("maxUses"),
  usedCount: int("usedCount").default(0).notNull(),
  // null = بلا حد لعدد المرات لكل عميل (شرط تكرار الاستخدام)
  maxUsesPerUser: int("maxUsesPerUser").default(1),
  // للعملاء الجدد فقط: يُرفض لمن سبق له دفع مكتمل
  firstPurchaseOnly: boolean("firstPurchaseOnly").default(false).notNull(),
  // للحسابات المُنشأة خلال هذا العدد من الأيام (null = بلا شرط)
  newAccountWithinDays: int("newAccountWithinDays"),
  // يقتصر على باقة بعينها (null = كل الباقات)
  planId: int("planId"),
  validFrom: timestamp("validFrom"),
  validUntil: timestamp("validUntil"),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const couponRedemptions = mysqlTable("coupon_redemptions", {
  id: int("id").autoincrement().primaryKey(),
  couponId: int("couponId").notNull().references(() => coupons.id),
  userId: int("userId").notNull().references(() => users.id),
  paymentId: int("paymentId"),
  // المبلغ المخصوم فعلاً بالريال — لا يُعاد حسابه لاحقاً من نسبة قد تتغيّر
  discountSar: decimal("discountSar", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Coupon = typeof coupons.$inferSelect;

// ─── تقارير الوكيل الخبير ─────────────────────────────────────────────────────
// التقارير كانت تعيش داخل المحادثات كرسائل عادية: لا عنوان ولا نوع ولا طريقة
// لفتح تقرير قديم دون التنقيب في شات. هنا تصير مستنداً له كيان مستقل.
// حقول المراجعة موجودة منذ البداية ليخدم الجدولُ لاحقاً طلبات موافقة العميل
// على ما ينفّذه الوكيل المبرمج، بدل جدول ثانٍ يكرّر نفس الشكل.
export const agentReports = mysqlTable("agent_reports", {
  id: int("id").autoincrement().primaryKey(),
  // صاحب التقرير: العميل الذي أُعدّ له (مالك الحساب)
  userId: int("userId").notNull().references(() => users.id),
  // المحادثة التي وُلد منها، إن وُجدت — للرجوع إلى السياق
  conversationId: int("conversationId"),
  kind: mysqlEnum("kind", [
    "system_assessment", "handover_terms", "contract_review",
    "policies", "workflow_design", "other",
  ]).default("other").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  // نص التقرير بصيغة Markdown
  content: text("content").notNull(),
  status: mysqlEnum("status", ["draft", "pending_review", "approved", "rejected"])
    .default("draft").notNull(),
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentReport = typeof agentReports.$inferSelect;

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

// ─── سجل تدقيق إجراءات الأدمن ─────────────────────────────────────────────────
// كل إجراء إداري حساس (تفعيل بدون دفع، منح نقاط، تمديد، تغيير حالة/دور) يُسجَّل
// هنا: مين نفّذه ومتى وعلى أي عميل، للتتبع والمراجعة لاحقاً
export const adminActionLog = mysqlTable("admin_action_log", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull().references(() => users.id),
  adminName: varchar("adminName", { length: 255 }),
  action: mysqlEnum("action", [
    "activate_subscription", "set_subscription_status", "grant_credits",
    "extend_days", "set_user_role", "set_user_active",
    // اطّلاع مالك المنصة على محادثة عميل — قراءة لا تعديل، لكنها تمسّ بيانات مالية
    "view_customer_conversation",
    // الإدارة تكتب كلمة سرّ في حساب عميل — فعلٌ يبقى له أثر
    "set_user_erp_connection",
  ]).notNull(),
  targetUserId: int("targetUserId").notNull(),
  targetUserEmail: varchar("targetUserEmail", { length: 320 }),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdminActionLogRow = typeof adminActionLog.$inferSelect;

// ─── سجل استهلاك نماذج الذكاء الاصطناعي (تكلفة بالدولار) ─────────────────────
// كل استدعاء LLM يُسجَّل هنا بعدد التوكنز والتكلفة المقدرة بالدولار، لمقارنته
// لحظياً بالإيرادات الفعلية المحصّلة في لوحة تحكم الأدمن
export const llmUsageLog = mysqlTable("llm_usage_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").references(() => users.id),
  // المزود والموديل الفعلي المستخدم، مثل openrouter أو openai أو builtin
  provider: varchar("provider", { length: 40 }).notNull(),
  // من أنفق: sara أو shahd أو غيرهما. المفتاح واحد بين التطبيقين، فما يعرضه
  // المزوّد مجموعٌ لا يُفصل — والفصل هنا أو لا يكون.
  app: varchar("app", { length: 40 }).default("sara").notNull(),
  model: varchar("model", { length: 120 }).notNull(),
  promptTokens: int("promptTokens").default(0).notNull(),
  completionTokens: int("completionTokens").default(0).notNull(),
  totalTokens: int("totalTokens").default(0).notNull(),
  // التكلفة التقديرية بالدولار الأمريكي بناءً على تسعير الموديل وقت الاستدعاء
  costUsd: decimal("costUsd", { precision: 12, scale: 6 }).default("0").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LlmUsageLogRow = typeof llmUsageLog.$inferSelect;

// ─── تأكيد البريد الإلكتروني ──────────────────────────────────────────────────
// توكن لمرة واحدة يُرسل برابط للمستخدم؛ نخزّن hash التوكن لا التوكن نفسه
export const emailVerificationTokens = mysqlTable("email_verification_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  email: varchar("email", { length: 320 }).notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;

// ─── رمز تحقق الدخول (OTP) ────────────────────────────────────────────────────
// يُنشأ بعد نجاح بيانات الدخول ويُطلب قبل إصدار الجلسة. نخزّن hash الرمز لا الرمز،
// ومعه عدّاد محاولات لمنع التخمين.
export const loginOtps = mysqlTable("login_otps", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  email: varchar("email", { length: 320 }).notNull(),
  codeHash: varchar("codeHash", { length: 64 }).notNull(),
  // معرّف عشوائي يُعاد للواجهة لربط الخطوة الثانية بالأولى دون كشف هوية المستخدم
  challengeId: varchar("challengeId", { length: 64 }).notNull().unique(),
  attempts: int("attempts").default(0).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoginOtp = typeof loginOtps.$inferSelect;

// ─── رمز تأكيد رقم الجوال ─────────────────────────────────────────────────────
// منفصل عن loginOtps لأن الغرض مختلف: هذا يثبت ملكية الرقم، وذاك يصدر جلسة.
export const phoneOtps = mysqlTable("phone_otps", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  phone: varchar("phone", { length: 20 }).notNull(),
  codeHash: varchar("codeHash", { length: 64 }).notNull(),
  challengeId: varchar("challengeId", { length: 64 }).notNull().unique(),
  attempts: int("attempts").default(0).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  // سبب فشل الإرسال إن وُجد — يُعرض للمدير ويُستخدم لإعادة المحاولة تلقائياً
  sendError: text("sendError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PhoneOtp = typeof phoneOtps.$inferSelect;
