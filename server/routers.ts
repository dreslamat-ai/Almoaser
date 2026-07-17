import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "./_core/llm";
import { agentRouter } from "./routers/agent";
import {
  getActivePlans, getPlanById,
  getSubscriptionByUserId, createSubscription, updateSubscription,
  getTasksByUserId, createTask, updateTask,
  getInvoicesByUserId,
  createRegistrationRequest,
  getAllRegistrationRequests, getAllSubscriptions, getAllTasks,
} from "./db";

// ─── ERPNext Session Cache ────────────────────────────────────────────────────
let erpnextSid: string | null = null;
let erpnextSidExpiry: number = 0;

async function getErpnextSession(): Promise<string> {
  const now = Date.now();
  // Reuse session if still valid (expires in 6 hours)
  if (erpnextSid && now < erpnextSidExpiry) {
    return erpnextSid;
  }

  const erpUrl = process.env.ERPNEXT_URL ?? "";
  const erpUser = process.env.ERPNEXT_USERNAME ?? "";
  const erpPass = process.env.ERPNEXT_PASSWORD ?? "";

  if (!erpUrl || !erpUser || !erpPass) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ERPNext credentials not configured" });
  }

  const loginRes = await fetch(`${erpUrl}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr: erpUser, pwd: erpPass }),
  });

  if (!loginRes.ok) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext login failed: ${loginRes.status}` });
  }

  // Extract SID from Set-Cookie header
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const sidMatch = setCookie.match(/sid=([^;]+)/);
  if (!sidMatch || sidMatch[1] === "Guest") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "ERPNext login returned Guest session" });
  }

  erpnextSid = sidMatch[1];
  erpnextSidExpiry = now + 6 * 60 * 60 * 1000; // 6 hours
  return erpnextSid;
}

async function erpFetch(path: string): Promise<unknown> {
  const erpUrl = process.env.ERPNEXT_URL ?? "";
  const sid = await getErpnextSession();
  const res = await fetch(`${erpUrl}${path}`, {
    headers: { Cookie: `sid=${sid}` },
  });
  if (!res.ok) {
    // If unauthorized, clear cached session and retry once
    if (res.status === 403 || res.status === 401) {
      erpnextSid = null;
      erpnextSidExpiry = 0;
      const sid2 = await getErpnextSession();
      const res2 = await fetch(`${erpUrl}${path}`, {
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
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user ?? null),
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
    get: protectedProcedure.query(({ ctx }) => getSubscriptionByUserId(ctx.user.id)),
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
  }),

  erpnext: router({
    testConnection: publicProcedure.query(async () => {
      try {
        const data = await erpFetch("/api/resource/Company?limit=5") as { data: Array<{ name: string }> };
        const companies = data?.data ?? [];
        if (companies.length === 0) return { connected: false, error: "لا توجد شركات" };

        // Get company details
        const companyName = companies[0].name;
        const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`) as { data: Record<string, unknown> };
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

    getCompanyInfo: publicProcedure.query(async () => {
      const data = await erpFetch("/api/resource/Company?limit=1") as { data: Array<{ name: string }> };
      const companies = data?.data ?? [];
      if (companies.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "لا توجد شركات" });

      const companyName = companies[0].name;
      const companyData = await erpFetch(`/api/resource/Company/${encodeURIComponent(companyName)}`) as { data: Record<string, unknown> };
      return companyData?.data ?? {};
    }),

    getAccounts: publicProcedure
      .input(z.object({ limit: z.number().optional().default(50), parentAccount: z.string().optional() }))
      .query(async ({ input }) => {
        let url = `/api/resource/Account?limit=${input.limit}&fields=["name","account_name","account_type","root_type","parent_account","is_group","account_currency"]&order_by=lft asc`;
        if (input.parentAccount) {
          url += `&filters=[["parent_account","=","${input.parentAccount}"]]`;
        }
        const data = await erpFetch(url) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getItems: publicProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input }) => {
        const data = await erpFetch(`/api/resource/Item?limit=${input.limit}&fields=["name","item_name","item_group","description","standard_rate","stock_uom","is_sales_item","is_purchase_item"]`) as { data: unknown[] };
        return data?.data ?? [];
      }),

    getJournalEntries: publicProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input }) => {
        try {
          const data = await erpFetch(`/api/resource/Journal Entry?limit=${input.limit}&fields=["name","title","posting_date","total_debit","total_credit","docstatus","voucher_type"]&order_by=posting_date desc`) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { data: [], error: message };
        }
      }),

    getAccountBalance: publicProcedure
      .input(z.object({ account: z.string() }))
      .query(async ({ input }) => {
        try {
          const data = await erpFetch(`/api/method/frappe.client.get_value?doctype=Account&fieldname=["account_name","account_type","root_type"]&filters={"name":"${encodeURIComponent(input.account)}"}`) as { message: Record<string, unknown> };
          return data?.message ?? {};
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
        }
      }),

    // ─── Dashboard Stats ──────────────────────────────────────────────────────
    getDashboardStats: publicProcedure.query(async () => {
      try {
        const [customersRes, invoicesRes, suppliersRes, itemsRes] = await Promise.allSettled([
          erpFetch("/api/resource/Customer?limit=500&fields=%5B%22name%22%5D") as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Sales%20Invoice?limit=500&fields=%5B%22name%22%2C%22grand_total%22%2C%22status%22%2C%22posting_date%22%5D&order_by=posting_date%20desc") as Promise<{ data: Array<{ name: string; grand_total: number; status: string; posting_date: string }> }>,
          erpFetch("/api/resource/Supplier?limit=500&fields=%5B%22name%22%5D") as Promise<{ data: unknown[] }>,
          erpFetch("/api/resource/Item?limit=500&fields=%5B%22name%22%5D") as Promise<{ data: unknown[] }>,
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

    getCustomers: publicProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input }) => {
        try {
          const data = await erpFetch(`/api/resource/Customer?limit=${input.limit}&fields=%5B%22name%22%2C%22customer_name%22%2C%22customer_type%22%2C%22mobile_no%22%2C%22email_id%22%5D&order_by=creation%20desc`) as { data: unknown[] };
          return { data: data?.data ?? [], error: null };
        } catch (err) {
          return { data: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),

    getSalesInvoices: publicProcedure
      .input(z.object({ limit: z.number().optional().default(20) }))
      .query(async ({ input }) => {
        try {
          const data = await erpFetch(`/api/resource/Sales%20Invoice?limit=${input.limit}&fields=%5B%22name%22%2C%22customer%22%2C%22posting_date%22%2C%22grand_total%22%2C%22outstanding_amount%22%2C%22status%22%2C%22currency%22%5D&order_by=posting_date%20desc`) as { data: unknown[] };
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
      .mutation(async ({ input }) => {
        const erpUrl = process.env.ERPNEXT_URL ?? "";
        const sid = await getErpnextSession();
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
      .mutation(async ({ input }) => {
        const erpUrl = process.env.ERPNEXT_URL ?? "demo.almoaser.cloud";
        let erpContext = "";
        try {
          const [customersRes, invoicesRes, itemsRes] = await Promise.allSettled([
            erpFetch("/api/resource/Customer?limit=20&fields=%5B%22name%22%2C%22customer_name%22%5D") as Promise<{ data: Array<{ name: string; customer_name: string }> }>,
            erpFetch("/api/resource/Sales%20Invoice?limit=10&fields=%5B%22name%22%2C%22customer%22%2C%22grand_total%22%2C%22status%22%5D&order_by=posting_date%20desc") as Promise<{ data: Array<{ name: string; customer: string; grand_total: number; status: string }> }>,
            erpFetch("/api/resource/Item?limit=20&fields=%5B%22name%22%2C%22item_name%22%2C%22standard_rate%22%5D") as Promise<{ data: Array<{ name: string; item_name: string; standard_rate: number }> }>,
          ]);
          const customers = customersRes.status === "fulfilled" ? customersRes.value?.data ?? [] : [];
          const invoices = invoicesRes.status === "fulfilled" ? invoicesRes.value?.data ?? [] : [];
          const items = itemsRes.status === "fulfilled" ? itemsRes.value?.data ?? [] : [];
          erpContext = `\nبيانات ERPNext الحالية (${erpUrl}):\n- العملاء (${customers.length}): ${customers.map((c: { name: string; customer_name: string }) => c.customer_name || c.name).slice(0, 10).join(", ")}\n- آخر الفواتير (${invoices.length}): ${invoices.slice(0, 5).map((i: { name: string; customer: string; grand_total: number; status: string }) => `${i.name} - ${i.customer} - ${i.grand_total} (${i.status})`).join(" | ")}\n- الاصناف (${items.length}): ${items.map((i: { name: string; item_name: string; standard_rate: number }) => `${i.item_name} (${i.standard_rate})`).slice(0, 10).join(", ")}`;
        } catch {
          erpContext = "لم يتمكن الوكيل من جلب بيانات ERPNext حالياً.";
        }

        const systemPrompt = `انت وكيل ذكاء اصطناعي متخصص في نظام ERPNext للمحاسبة والمبيعات والمشتريات.\nتعمل مع شركة تستخدم نظام Almoaser AI Powered ERP.\nمهمتك: مساعدة المستخدم في انشاء الفواتير، جلب التقارير، الاستعلام عن العملاء والاصناف، وتنفيذ العمليات المحاسبية.\nتحدث دائما بالعربية وكن مختصرا ومفيدا.\nعند طلب انشاء فاتورة، اطلب: اسم العميل، الصنف، الكمية، السعر.\nعند طلب تقرير، قدم ملخصا واضحا من البيانات المتاحة.\n${erpContext}`;

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
