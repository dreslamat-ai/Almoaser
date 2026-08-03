import { useState, useCallback } from "react";
import { Bell, BellRing, Check, CheckCheck, Trash2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// تحويل تاريخ الإشعار إلى نص نسبي عربي مبسط
function timeAgo(d: Date | string): string {
  const t = new Date(d).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "الآن";
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const days = Math.floor(h / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(t).toLocaleDateString("ar");
}

// تحويل مفتاح VAPID base64url إلى Uint8Array كما يتطلب pushManager
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const { data: unread } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30000, // تحديث العدّاد كل 30 ثانية
  });
  const { data: items, isLoading } = trpc.notifications.list.useQuery(
    { limit: 30 },
    { enabled: open },
  );

  const invalidate = useCallback(() => {
    utils.notifications.list.invalidate();
    utils.notifications.unreadCount.invalidate();
  }, [utils]);

  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notifications.markAllRead.useMutation({ onSuccess: invalidate });
  const del = trpc.notifications.delete.useMutation({ onSuccess: invalidate });
  const subscribePush = trpc.notifications.subscribePush.useMutation();

  // تفعيل إشعارات الجهاز (Web Push)
  const enableDevicePush = async () => {
    setPushBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        toast.error("متصفحك لا يدعم إشعارات الجهاز");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("لم يُسمح بالإشعارات — فعّلها من إعدادات المتصفح");
        return;
      }
      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidKey) {
        toast.error("إشعارات الجهاز غير مهيأة");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
        });
      }
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        toast.error("تعذر إنشاء اشتراك الإشعارات");
        return;
      }
      await subscribePush.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      localStorage.setItem("devicePushEnabled", "1");
      toast.success("تم تفعيل إشعارات الجهاز — ستصلك حتى والتطبيق مغلق");
    } catch {
      toast.error("تعذر تفعيل إشعارات الجهاز");
    } finally {
      setPushBusy(false);
    }
  };

  const pushEnabled =
    typeof window !== "undefined" &&
    localStorage.getItem("devicePushEnabled") === "1" &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted";

  const count = unread ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="الإشعارات">
          {count > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
          {count > 0 && (
            <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center leading-none">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0" style={{ direction: "rtl" }}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">الإشعارات</span>
          {count > 0 && (
            <button
              className="text-xs text-primary hover:underline flex items-center gap-1"
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" /> تعليم الكل كمقروء
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !items || items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              لا توجد إشعارات بعد
            </div>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-2 px-3 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-accent/50 transition-colors ${
                  n.readAt ? "opacity-70" : "bg-primary/5"
                }`}
                onClick={() => {
                  if (!n.readAt) markRead.mutate({ id: n.id });
                  if (n.link) {
                    setOpen(false);
                    navigate(n.link);
                  }
                }}
              >
                {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!n.readAt && (
                    <button
                      className="p-1 rounded hover:bg-accent"
                      title="تعليم كمقروء"
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate({ id: n.id });
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    className="p-1 rounded hover:bg-accent text-red-500"
                    title="حذف"
                    onClick={(e) => {
                      e.stopPropagation();
                      del.mutate({ id: n.id });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {!pushEnabled && (
          <div className="border-t px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={pushBusy}
              onClick={enableDevicePush}
            >
              {pushBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />
              ) : (
                <BellRing className="h-3.5 w-3.5 ml-1" />
              )}
              تفعيل إشعارات الجهاز (تصلك والتطبيق مغلق)
            </Button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
