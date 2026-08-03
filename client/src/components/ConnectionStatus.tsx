import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * حالة ربط العميل بنظامه — لمبة في كل شاشة، وشريط دائم حين ينقطع.
 *
 * **لماذا وُجد هذا:** عميلٌ حقيقي أمضى جلسة كاملة يحاول إضافة عميل وإنشاء
 * فاتورة، والوكيل يرفض في كل مرة، ولا شيء في الواجهة يقول إن ربطه مقطوع.
 * ظنّ العطل في المنتج، ونحن لم نعلم إلا حين اشتكى.
 *
 * **واللون وحده لا يكفي:** اللمبة معها نصّ («متصل» / «غير متصل»)، فمن لا
 * يميّز الأحمر من الأخضر يقرأ الحال كما يقرؤه غيره.
 */

/** يُعاد الفحص كل دقيقتين — والخادم يخزّنه مثلها فلا يُثقَل نظام العميل */
const REFRESH_MS = 2 * 60 * 1000;

export function ConnectionLamp({ className = "" }: { className?: string }) {
  const { data, isLoading } = trpc.erpConnection.status.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${className}`}>
        <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
        جارٍ الفحص
      </span>
    );
  }

  if (!data.configured) {
    return (
      <Link href="/channels" className={`inline-flex items-center gap-1.5 text-xs text-amber-700 hover:underline ${className}`}>
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        لم يُربط بعد
      </Link>
    );
  }

  return data.ok ? (
    <span className={`inline-flex items-center gap-1.5 text-xs text-emerald-700 ${className}`} title={data.url}>
      <span className="relative flex w-2 h-2">
        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
      </span>
      <Wifi className="w-3.5 h-3.5" />
      متصل
    </span>
  ) : (
    <Link
      href="/channels"
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-red-700 hover:underline ${className}`}
      title={data.reason}
    >
      <span className="w-2 h-2 rounded-full bg-red-500" />
      <WifiOff className="w-3.5 h-3.5" />
      غير متصل
    </Link>
  );
}

/**
 * شريط دائم لا يُغلَق ما دام الربط مقطوعاً.
 *
 * **ولا زرّ إغلاق:** الإشعار الذي يُغلَق يُغلَق ثم يُنسى، والعميل يظلّ يحاول
 * ويفشل. يختفي وحده حين يعمل الربط — وذلك هو الإغلاق الوحيد المقبول.
 */
export function ConnectionBanner() {
  const { data } = trpc.erpConnection.status.useQuery(undefined, {
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  if (!data || !data.configured || data.ok) return null;

  return (
    <div className="sticky top-0 z-40 bg-red-600 text-white" role="alert">
      <div className="container flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="font-medium">نظامك غير متصل — لن تُنفَّذ أي عملية حتى يُصلَح الربط.</span>
        {data.reason && <span className="opacity-90 text-[13px]">{data.reason}</span>}
        <Link
          href="/channels"
          className="mr-auto bg-white text-red-700 rounded-lg px-3 py-1 text-[13px] font-bold hover:bg-red-50"
        >
          إصلاح الربط
        </Link>
      </div>
    </div>
  );
}
