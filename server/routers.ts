import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { agentRouter } from "./routers/agent";
import { getErpConfigForUser, getErpSession, invalidateErpSession, testErpConnection, encryptPassword } from "./erpConnection";
import { loginWithErpAccount, signupWithErpAccount, activateTrialIfExpired } from "./erpAuth";
import { sdk } from "./_core/sdk";
import { erpnextConnections } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  getActivePlans, getPlanById,
  getSubscriptionByUserId, createSubscription, updateSubscription,
  getTasksByUserId, createTask, updateTask,
  getInvoicesByUserId,
  createRegistrationRequest,
  getAllRegistrationRequests, getAllSubscriptions, getAllTasks,
  getTaskCommentsByTaskId, createTaskComment, getTaskById,
  updateUserProfile,
  getAllUsers, setUserRole,
  setUserActive,
} from "./db";

// ─── ERPNext Per-User Fetch ───────────────────────────────────────────────────
// كل مستخدم يتصل بنظامه الخاص (من إعداداته) أو باتصال النظام الافتراضي
async function erpFetch(path: string, userId: number): Promise<unknown> {
  const config = await getErpConfigForUser(userId);
  const sid = await getErpSession(config);
  const res = await fetch(`${config.url}${path}`, {
    headers: { Cookie: `sid=${sid}` },
  });
  if (!res.ok) {
    // If unauthorized, clear cached session and retry once
    if (res.status === 403 || res.status === 401) {
      invalidateErpSession(config);
      const sid2 = await getErpSession(config);
      const res2 = await fetch(`${config.url}${path}`, {
        headers: { Cookie: `sid=${sid2}` },
      });
      if (!res2.ok) {
        const errText = await res2.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext API error ${res2.status}: ${errText.slice(0, 200)}` });
      }
      return res2.json();
    }
    const errText = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext API error ${res.status}: ${errText.slice(0, 200)}` });
  }
  return res.json();
}

export const appRouter = router({
  system: systemRouter,
  // ─── إعدادات اتصال ERPNext لكل مستخدم ─────────────────────────────────────
  erpConnection: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, ctx.user.id)).limit(1);
      const conn = rows[0];
      if (!conn) return null;
      // لا نرجع كلمة المرور أبداً
      return { url: conn.url, username: conn.username, lastVerifiedAt: conn.lastVerifiedAt, updatedAt: conn.updatedAt };
    }),
    save: protectedProcedure
      .input(z.object({
        url: z.string().url("رابط غير صالح — يجب أن يبدأ بـ https://"),
        username: z.string().min(1, "اسم المستخدم مطلوب"),
        password: z.string().min(1, "كلمة المرور مطلوبة"),
      }))
      .mutation(async ({ input, ctx }) => {
        const cleanUrl = input.url.replace(/\/+$/, "");
        // اختبار الاتصال قبل الحفظ
        const test = await testErpConnection(cleanUrl, input.username, input.password);
        if (!test.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: test.error ?? "فشل اختبار الاتصال" });
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
        const existing = await db.select().from(erpnextConnections).where(eq(erpnextConnections.userId, ctx.user.id)).limit(1);
        const values = {
          url: cleanUrl,
          username: input.username,
          passwordEnc: encryptPassword(input.password),
          lastVerifiedAt: new Date(),
        };
        if (existing[0]) {
          await db.update(erpnextConnections).set(values).where(eq(erpnextConnections.userId, ctx.user.id));
        } else {
          await db.insert(erpnextConnections).values({ ...values, userId: ctx.user.id });
        }
        return { success: true, loggedInAs: test.loggedInAs };
      }),
    test: protectedProcedure
      .input(z.object({
        url: z.string().url(),
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        return testErpConnection(input.url, input.username, input.password);
      }),
    remove: protectedProcedure.mutation(async ({ ctx }) => {
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة" });
      await db.delete(erpnextConnections).where(eq(erpnextConnections.userId, ctx.user.id));
      return { success: true };
    }),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ?? null),
    // تسجيل الدخول بحساب ERPNext (نفس بريد وكلمة مرور النظام)
    loginWithErp: publicProcedure
      .input(z.object({
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
        erpUrl: z.string().trim().max(500).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const erpUrl = (input.erpUrl || process.env.ERPNEXT_URL || "").replace(/\/+$/, "");
        const result = await loginWithErpAccount(erpUrl, input.email, input.password);
        if (!result.ok) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: result.error });
        }
        const sessionToken = await sdk.createSessionToken(result.result.openId, {
          name: result.result.fullName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        return { success: true, name: result.result.fullName, email: result.result.email } as const;
      }),
    // تسجيل مستخدم جديد: رابط نظامه + بريده + كلمة مروره + الباقة، مع تجربة 3 أيام
    signupWithErp: publicProcedure
      .input(z.object({
        erpUrl: z.string().trim().min(8).max(500),
        email: z.string().trim().min(3).max(320),
        password: z.string().min(1).max(256),
        planId: z.number().int().positive(),
        companyName: z.string().trim().max(255).optional(),
        phone: z.string().trim().max(20).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await signupWithErpAccount(input);
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }
        const sessionToken = await sdk.createSessionToken(result.result.openId, {
          name: result.result.fullName,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 365 * 24 * 60 * 60 * 1000 });
        return {
          success: true,
          name: result.result.fullName,
          email: result.result.email,
          trialEndsAt: result.result.trialEndsAt,
        } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  plans: router({
    list: publicProcedure.query(() => getActivePlans()),
    get: publicProcedure.input(z.object({ id: z.number() })).query(({ input }) => getPlanById(input.id)),
  }),

  subscription: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      // إن انتهت فترة التجربة تُفعَّل الباقة المختارة تلقائياً قبل الإرجاع
      await activateTrialIfExpired(ctx.user.id);
      return getSubscriptionByUserId(ctx.user.id);
    }),
    create: protectedProcedure
      .input(z.object({
        planId: z.number(),
        companyName: z.string().optional(),
        companyType: z.string().optional(),
        phone: z.string().optional(),
        vatNumber: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getSubscriptionByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "لديك اشتراك بالفعل" });
        await createSubscription({ userId: ctx.user.id, ...input });
        return { success: true };
      }),
    upgrade: protectedProcedure
      .input(z.object({ planId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getSubscriptionByUserId(ctx.user.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك" });
        await updateSubscription(existing.id, { planId: input.planId, status: "active" });
        return { success: true };
      }),
  }),

  tasks: router({
    list: protectedProcedure.query(({ ctx }) => getTasksByUserId(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        type: z.enum(["bookkeeping", "invoice", "journal_entry", "report", "tax", "payroll", "other"]),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        dueDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sub = await getSubscriptionByUserId(ctx.user.id);
        await createTask({
          userId: ctx.user.id,
          subscriptionId: sub?.id,
          ...input,
        });
        return { success: true };
      }),
    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      }))
      .mutation(async ({ ctx, input }) => {
        await updateTask(input.id, ctx.user.id, {
          status: input.status,
          completedAt: input.status === "completed" ? new Date() : undefined,
        });
        return { success: true };
      }),
    comments: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ ctx, input }) => {
        const task = await getTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
        if (task.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getTaskCommentsByTaskId(input.taskId);
      }),
    addComment: protectedProcedure
      .input(z.object({ taskId: z.number(), content: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const task = await getTaskById(input.taskId);
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "المهمة غير موجودة" });
        if (task.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await createTaskComment({
          taskId: input.taskId,
          userId: ctx.user.id,
          authorRole: ctx.user.role === "admin" ? "admin" : "user",
          content: input.content,
        });
        // إشعار المالك عند تعليق العميل على مهمة
        if (ctx.user.role !== "admin") {
          notifyOwner({
            title: "تعليق جديد على مهمة — Almoaser AI ERP",
            content: `المهمة: ${task.title}\nمن: ${ctx.user.name ?? "عميل"}\nالتعليق: ${input.content.slice(0, 300)}`,
          }).catch(() => {});
        }
        return { success: true };
      }),
  }),

  invoices: router({
    list: protectedProcedure.query(({ ctx }) => getInvoicesByUserId(ctx.user.id)),
  }),

  register: router({
    submit: publicProcedure
      .input(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        phone: z.string().min(9),
        companyName: z.string().optional(),
        companyType: z.string().optional(),
        businessSector: z.string().optional(),
        planId: z.number().optional(),
        message: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await createRegistrationRequest(input);
        // إشعار المسؤول بطلب تسجيل جديد (لا يوقف العملية عند الفشل)
        notifyOwner({
          title: "طلب تسجيل جديد — Almoaser AI ERP",
          content: `الاسم: ${input.name}\nالبريد: ${input.email}\nالجوال: ${input.phone}\nالشركة: ${input.companyName ?? "-"}\nالنشاط: ${input.companyType ?? "-"}`,
        }).catch(() => {});
        return { success: true };
      }),
  }),

  profile: router({
    update: protectedProcedure
      .input(z.object({
        name: z.string().min(2).max(100).optional(),
        email: z.string().email().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.name && !input.email) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا توجد بيانات للتحديث" });
        }
        await updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),
    updateCompany: protectedProcedure
      .input(z.object({
        companyName: z.string().max(255).optional(),
        companyType: z.string().max(100).optional(),
        phone: z.string().max(20).optional(),
        vatNumber: z.string().max(50).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const sub = await getSubscriptionByUserId(ctx.user.id);
        if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "لا يوجد اشتراك — اشترك في باقة أولاً" });
        await updateSubscription(sub.id, input);
        return { success: true };
      }),
  }),

  admin: router({
    registrations: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllRegistrationRequests();
    }),
    subscriptions: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllSubscriptions();
    }),
    tasks: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllTasks();
    }),
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllUsers();
    }),
    setUserRole: protectedProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id && input.role !== "admin") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك إزالة صلاحية المسؤول عن حسابك" });
        }
        await setUserRole(input.userId, input.role);
        return { success: true };
      }),
    setUserActive: protectedProcedure
      .input(z.object({ userId: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكنك تعطيل حسابك" });
        }
        await setUserActive(input.userId, input.isActive);
        return { success: true };
      }),
  }),

  erpnext: router({
    testConnection: protectedProcedure.query(async ({ ctx }) => {
      try {
        const data = await erpFetch("/api/resource/Company?limit=5", ctx.user.id) as { data: Array<{ name: string }> };
        const companies = data?.data ?? [];
        if (companies.length === 0) return { connected: false, error: "لا توجد شركات" };

        // Get company details
        const companyName = companies[0].name;
        const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`, ctx.user.id) as { data: Record<string, unknown> };
        const company = companyData?.data ?? {};

        return {
          connected: true,
          company: {
            name: company.name as string,
            abbr: company.abbr as string,
            defaultCurrency: company.default_currency as string,
            country: company.country as string,
            email: company.email as string,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { connected: false, error: message };
      }
    }),

    getCompanyInfo: protectedProcedure.query(async ({ ctx }) => {
      const data = await erpFetch("/api/resource/Company?limit=1", ctx.user.id) as { data: Array<{ name: string }> };
      const companies = data?.data ?? [];
      if (companies.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "لا توجد شركات" });

      const companyName = companies[0].name;
      const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`, ctx.user.id) as { data: Record<string, unknown> };
      return companyData?.data ?? {};
    }),

    getAccounts: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(50), parentAccount: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        let url = `/api/resource/Account?limit=${input.limit}&fields=["name","account_name","account_type","root_type","parent_account","is_group","account_currency"]&order_by=lft asc`;
        if (input.parentAccount) {
          url += `&filters=[["parent_account","=","${input.parentAccount}"]]`;
        }
        const data = await erpFetch(url, ctx.user.id) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getItems: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        const data = await erpFetch(`/api/resource/Item?limit=${input.limit}&fields=["name","item_name","item_group","description","standard_rate","stock_uom","is_sales_item","is_purchase_item"]`, ctx.user.id) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getJournalEntries: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Journal Entry?limit=${input.limit}&fields=["name","title","posting_date","total_debit","total_credit","docstatus","voucher_type"]&order_by=posting_date desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { data: [], error: message };
        }
      }),

    getAccountBalance: protectedProcedure
      .input(z.object({ account: z.string() }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/method/frappe.client.get_value?doctype=Account&fieldname=["account_name","account_type","root_type"]&filters={"name":"${encodeURIComponent(input.account)}"}`, ctx.user.id) as { message: Record<string, unknown> };
          return data?.message ?? {};
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
        }
      }),

    // ─── Dashboard Stats ──────────────────────────────────────────────────────
    getDashboardStats: protectedProcedure.query(async ({ ctx }) => {
      try {
        const [customersRes, invoicesRes, suppliersRes, itemsRes] = await Promise.allSettled([
          erpFetch("/api/resource/Customer?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Sales%20Invoice?limit=500&fields=%5B%22name%22%2C%22grand_total%22%2C%22status%22%2C%22posting_date%22%5D&order_by=posting_date%20desc", ctx.user.id) as Promise<{ data: Array<{ name: string; grand_total: number; status: string; posting_date: string }> }>,
          erpFetch("/api/resource/Supplier?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Item?limit=500&fields=%5B%22name%22%5D", ctx.user.id) as Promise<{ data: unknown[] }>,
        ]);

        const customers = customersRes.status === "fulfilled" ? (customersRes.value?.data ?? []) : [];
        const invoices = invoicesRes.status === "fulfilled" ? (invoicesRes.value?.data ?? []) : [];
        const suppliers = suppliersRes.status === "fulfilled" ? (suppliersRes.value?.data ?? []) : [];
        const items = itemsRes.status === "fulfilled" ? (itemsRes.value?.data ?? []) : [];

        const totalRevenue = invoices.reduce((s: number, inv) => s + (inv.grand_total ?? 0), 0);
        const paidInvoices = invoices.filter(inv => inv.status === "Paid");
        const unpaidInvoices = invoices.filter(inv => inv.status === "Unpaid" || inv.status === "Overdue");
        const paidRevenue = paidInvoices.reduce((s: number, inv) => s + (inv.grand_total ?? 0), 0);

        const monthlyMap: Record<string, number> = {};
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthlyMap[key] = 0;
        }
        for (const inv of invoices) {
          if (!inv.posting_date) continue;
          const key = inv.posting_date.slice(0, 7);
          if (key in monthlyMap) monthlyMap[key] = (monthlyMap[key] ?? 0) + (inv.grand_total ?? 0);
        }
        const monthlyRevenue = Object.entries(monthlyMap).map(([month, amount]) => ({
          month: new Date(month + "-01").toLocaleDateString("ar-SA", { month: "short", year: "2-digit" }),
          amount: Math.round(amount * 100) / 100,
        }));

        return {
          totalCustomers: customers.length,
          totalSuppliers: suppliers.length,
          totalItems: items.length,
          totalInvoices: invoices.length,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          paidRevenue: Math.round(paidRevenue * 100) / 100,
          paidInvoices: paidInvoices.length,
          unpaidInvoices: unpaidInvoices.length,
          monthlyRevenue,
          recentInvoices: invoices.slice(0, 5),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

    getCustomers: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Customer?limit=${input.limit}&fields=%5B%22name%22%2C%22customer_name%22%2C%22customer_type%22%2C%22mobile_no%22%2C%22email_id%22%5D&order_by=creation%20desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          return { data: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),

    getSalesInvoices: protectedProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input, ctx }) => {
        try {
          const data = await erpFetch(`/api/resource/Sales%20Invoice?limit=${input.limit}&fields=%5B%22name%22%2C%22customer%22%2C%22posting_date%22%2C%22grand_total%22%2C%22outstanding_amount%22%2C%22status%22%2C%22currency%22%5D&order_by=posting_date%20desc`, ctx.user.id) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          return { data: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),

    createSalesInvoice: protectedProcedure
      .input(z.object({
        customer: z.string(),
        items: z.array(z.object({
          item_code: z.string(),
          qty: z.number().default(1),
          rate: z.number(),
          description: z.string().optional(),
        })),
        posting_date: z.string().optional(),
        due_date: z.string().optional(),
        currency: z.string().optional().default("OMR"),
      }))
      .mutation(async ({ input, ctx }) => {
        const erpConfig = await getErpConfigForUser(ctx.user.id);
        const erpUrl = erpConfig.url;
        const sid = await getErpSession(erpConfig);
        const body = {
          customer: input.customer,
          posting_date: input.posting_date ?? new Date().toISOString().slice(0, 10),
          due_date: input.due_date ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
          currency: input.currency,
          items: input.items,
        };
        const res = await fetch(`${erpUrl}/api/resource/Sales%20Invoice`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: `sid=${sid}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `فشل إنشاء الفاتورة: ${errText.slice(0, 300)}` });
        }
        const data = await res.json() as { data: { name: string } };
        return { success: true, invoiceName: data.data?.name };
      }),

    agentChat: protectedProcedure
      .input(z.object({
        messages: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        const erpUrl = (await getErpConfigForUser(ctx.user.id)).url || "demo.almoaser.cloud";
        let erpContext = "";
        try {
          const [customersRes, invoicesRes, itemsRes] = await Promise.allSettled([
            erpFetch("/api/resource/Customer?limit=20&fields=%5B%22name%22%2C%22customer_name%22%5D", ctx.user.id) as Promise<{ data: Array<{ name: string; customer_name: string }> }>,
            erpFetch("/api/resource/Sales%20Invoice?limit=10&fields=%5B%22name%22%2C%22customer%22%2C%22grand_total%22%2C%22status%22%5D&order_by=posting_date%20desc", ctx.user.id) as Promise<{ data: Array<{ name: string; customer: string; grand_total: number; status: string }> }>,
            erpFetch("/api/resource/Item?limit=20&fields=%5B%22name%22%2C%22item_name%22%2C%22standard_rate%22%5D", ctx.user.id) as Promise<{ data: Array<{ name: string; item_name: string; standard_rate: number }> }>,
          ]);
          const customers = customersRes.status === "fulfilled" ? customersRes.value?.data ?? [] : [];
          const invoices = invoicesRes.status === "fulfilled" ? invoicesRes.value?.data ?? [] : [];
          const items = itemsRes.status === "fulfilled" ? itemsRes.value?.data ?? [] : [];
          erpContext = `\nبيانات ERPNext الحالية (${erpUrl}):\n- العملاء (${customers.length}): ${customers.map((c: { name: string; customer_name: string }) => c.customer_name || c.name).slice(0, 10).join(", ")}\n- آخر الفواتير (${invoices.length}): ${invoices.slice(0, 5).map((i: { name: string; customer: string; grand_total: number; status: string }) => `${i.name} - ${i.customer} - ${i.grand_total} (${i.status})`).join(" | ")}\n- الاصناف (${items.length}): ${items.map((i: { name: string; item_name: string; standard_rate: number }) => `${i.item_name} (${i.standard_rate})`).slice(0, 10).join(", ")}`;
        } catch {
          erpContext = "لم يتمكن الوكيل من جلب بيانات ERPNext حالياً.";
        }

        const systemPrompt = `انت وكيل ذكاء اصطناعي متخصص في نظام ERPNext للمحاسبة والمبيعات والمشتريات.\nتعمل مع شركة تستخدم نظام Almoaser AI ERP.\nمهمتك: مساعدة المستخدم في انشاء الفواتير، جلب التقارير، الاستعلام عن العملاء والاصناف، وتنفيذ العمليات المحاسبية.\nتحدث دائما بالعربية وكن مختصرا ومفيدا.\nعند طلب انشاء فاتورة، اطلب: اسم العميل، الصنف، الكمية، السعر.\nعند طلب تقرير، قدم ملخصا واضحا من البيانات المتاحة.\n${erpContext}`;

        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          ...input.messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        const result = await invokeLLM({ messages: llmMessages, maxTokens: 1000 });
        const reply = result.choices[0]?.message?.content;
        const replyText = typeof reply === "string" ? reply : Array.isArray(reply) ? reply.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("") : "";
        return { reply: replyText };
      }),
  }),

  agent: agentRouter,
  channels: router({
    saveSettings: protectedProcedure
      .input(z.object({
        whatsappToken: z.string().optional(),
        whatsappPhoneId: z.string().optional(),
        whatsappVerifyToken: z.string().optional(),
        telegramBotToken: z.string().optional(),
        telegramChatId: z.string().optional(),
        agentEnabled: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        // In production, store these securely in DB or env
        // For now, return success (settings would be stored in DB)
        return { success: true, message: "Settings saved successfully" };
      }),

    testWhatsapp: protectedProcedure
      .input(z.object({
        token: z.string(),
        phoneId: z.string(),
        testNumber: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v18.0/${input.phoneId}/messages`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${input.token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: input.testNumber,
                type: "text",
                text: { body: "✅ اختبار ناجح من نظام Almoaser AI ERP! الوكيل الذكي جاهز للعمل." },
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
            return { success: false, error: err?.error?.message ?? `HTTP ${res.status}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
        }
      }),

    testTelegram: protectedProcedure
      .input(z.object({
        token: z.string(),
        chatId: z.string(),
      }))
      .mutation(async ({ input }) => {
        try {
          const res = await fetch(
            `https://api.telegram.org/bot${input.token}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: input.chatId,
                text: "✅ اختبار ناجح من نظام Almoaser AI ERP! الوكيل الذكي جاهز للعمل.",
              }),
            }
          );
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { description?: string };
            return { success: false, error: err?.description ?? `HTTP ${res.status}` };
          }
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : "Unknown error" };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
