import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getActivePlans, getPlanById,
  getSubscriptionByUserId, createSubscription, updateSubscription,
  getTasksByUserId, createTask, updateTask,
  getInvoicesByUserId,
  createRegistrationRequest,
  getAllRegistrationRequests, getAllSubscriptions, getAllTasks,
} from "./db";
import { TRPCError } from "@trpc/server";

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
});

export type AppRouter = typeof appRouter;
