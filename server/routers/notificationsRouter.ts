import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  deleteNotification,
  listNotifications,
  markAllRead,
  markRead,
  removePushSubscription,
  savePushSubscription,
  unreadCount,
} from "../notifications";

export const notificationsRouter = router({
  // قائمة إشعارات المستخدم (الأحدث أولاً)
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return listNotifications(ctx.user.id, input?.limit ?? 30);
    }),

  // عدد غير المقروء (للعدّاد على الجرس)
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return unreadCount(ctx.user.id);
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await markRead(ctx.user.id, input.id);
      return { success: true };
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await markAllRead(ctx.user.id);
    return { success: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await deleteNotification(ctx.user.id, input.id);
      return { success: true };
    }),

  // تسجيل اشتراك Web Push لجهاز المستخدم
  subscribePush: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().min(1),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await savePushSubscription(ctx.user.id, input);
      return { success: true };
    }),

  unsubscribePush: protectedProcedure
    .input(z.object({ endpoint: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await removePushSubscription(ctx.user.id, input.endpoint);
      return { success: true };
    }),
});
