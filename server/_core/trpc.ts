import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // بدون هذا، فشل تحقق Zod (مثل كلمة مرور قصيرة) يصل للواجهة كـ JSON خام غير
  // مقروء بدل رسالة عربية واضحة — نحوّله هنا لأول رسالة تحقق مفهومة
  errorFormatter(opts) {
    const { shape, error } = opts;
    if (error.cause instanceof ZodError) {
      const first = error.cause.issues[0];
      const fieldPath = first?.path?.join(".");
      const readable = first ? (fieldPath ? `${fieldPath}: ${first.message}` : first.message) : shape.message;
      return { ...shape, message: readable };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // المستخدمون المعطلون من لوحة الإدارة لا يمكنهم استخدام النظام
  if ((ctx.user as { isActive?: boolean }).isActive === false) {
    throw new TRPCError({ code: "FORBIDDEN", message: "تم تعطيل حسابك. يرجى التواصل مع الإدارة." });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
