import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
  }),
});

export type AppRouter = typeof appRouter;
