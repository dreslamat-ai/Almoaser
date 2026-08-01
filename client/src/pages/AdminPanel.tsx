import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, FileText, CheckCircle2, Shield, Clock, Building2, Phone, Mail, Calendar, Zap,
  ChevronDown, ChevronUp, Coins, Hash, StickyNote, Gift, PlusCircle, CalendarPlus, Receipt, Ban,
  Search, DollarSign, TrendingUp, Download, Cpu, RefreshCw,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState, Fragment } from "react";
import { toast } from "sonner";

/**
 * بيانات الاستهلاك لحظية: تُجلب من جديد عند كل فتح للصفحة (لا نعرض نسخة مخزَّنة)،
 * وكل 15 ثانية أثناء بقاء الصفحة مفتوحة، وعند الرجوع إليها من تبويب آخر.
 * الجداول صغيرة (استعلامات تجميع بسيطة) فالتكلفة مهملة.
 */
const LIVE_REFRESH_MS = 15000;
const liveQueryOptions = {
  refetchInterval: LIVE_REFRESH_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  refetchOnMount: "always",
  staleTime: 0,
} as const;

/** مؤشر "مباشر" مع وقت آخر تحديث وزر تحديث فوري */
function LiveBadge({ updatedAt, isFetching, onRefresh }: {
  updatedAt: number; isFetching: boolean; onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
      <span className="relative flex w-2 h-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-70 animate-ping" />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
      </span>
      <span>
        مباشر · آخر تحديث{" "}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {updatedAt ? new Date(updatedAt).toLocaleTimeString("en-GB") : "—"}
        </span>
      </span>
      <button
        type="button" onClick={onRefresh} disabled={isFetching}
        className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-3 py-1 [@media(pointer:coarse)]:min-h-11 hover:border-navy hover:text-navy transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
        تحديث
      </button>
    </div>
  );
}

const subStatusOptions = [
  { value: "active", label: "نشط" },
  { value: "trial", label: "تجريبي" },
  { value: "inactive", label: "معطّل" },
  { value: "cancelled", label: "ملغي" },
] as const;

function SubscriptionActionsPanel({ userId, plans }: { userId: number; plans: Array<{ id: number; nameAr: string }> | undefined }) {
  const utils = trpc.useUtils();
  const [activatePlanId, setActivatePlanId] = useState<string>("");
  const [activateBilling, setActivateBilling] = useState<"monthly" | "yearly">("monthly");
  const [creditsAmount, setCreditsAmount] = useState("");
  const [extendDays, setExtendDays] = useState("");

  const { data: paymentHistory } = trpc.admin.paymentsForUser.useQuery({ userId });
  const { data: invoices } = trpc.admin.invoicesForUser.useQuery({ userId });

  const invalidateAll = () => {
    utils.admin.subscriptions.invalidate();
    utils.admin.usageSummary.invalidate();
    utils.admin.paymentsForUser.invalidate({ userId });
  };

  const statusMutation = trpc.admin.setSubscriptionStatus.useMutation({
    onSuccess: () => { toast.success("تم تحديث حالة الاشتراك"); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const activateMutation = trpc.admin.activateSubscription.useMutation({
    onSuccess: () => { toast.success("تم تفعيل الباقة بدون دفع"); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const creditsMutation = trpc.admin.grantCredits.useMutation({
    onSuccess: () => { toast.success("تم منح النقاط"); setCreditsAmount(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });
  const extendMutation = trpc.admin.extendSubscriptionDays.useMutation({
    onSuccess: () => { toast.success("تم تمديد الاشتراك"); setExtendDays(""); invalidateAll(); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* حالة الاشتراك */}
        <div className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1.5"><Ban className="w-3.5 h-3.5" /> حالة الاشتراك</div>
          <Select value="" onValueChange={v => statusMutation.mutate({ userId, status: v as typeof subStatusOptions[number]["value"] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="تغيير الحالة..." /></SelectTrigger>
            <SelectContent>
              {subStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* تفعيل بدون دفع */}
        <div className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1.5"><Gift className="w-3.5 h-3.5" /> تفعيل بدون دفع</div>
          <div className="flex gap-1">
            <Select value={activatePlanId} onValueChange={setActivatePlanId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="اختر باقة" /></SelectTrigger>
              <SelectContent>
                {plans?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs shrink-0" disabled={!activatePlanId || activateMutation.isPending}
              onClick={() => activateMutation.mutate({ userId, planId: Number(activatePlanId), billing: activateBilling })}>
              تفعيل
            </Button>
          </div>
        </div>

        {/* منح نقاط */}
        <div className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1.5"><PlusCircle className="w-3.5 h-3.5" /> منح نقاط</div>
          <div className="flex gap-1">
            <Input type="number" min={1} value={creditsAmount} onChange={e => setCreditsAmount(e.target.value)} placeholder="عدد النقاط" className="h-8 text-xs" />
            <Button size="sm" className="h-8 text-xs shrink-0" disabled={!creditsAmount || creditsMutation.isPending}
              onClick={() => {
                const n = Number(creditsAmount);
                if (n > 2000 && !window.confirm(`تأكيد منح ${n} نقطة (قيمة مكافئة تقريبية ${(n)} ريال) — هل أنت متأكد؟`)) return;
                creditsMutation.mutate({ userId, credits: n });
              }}>
              منح
            </Button>
          </div>
        </div>

        {/* تمديد أيام */}
        <div className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1.5"><CalendarPlus className="w-3.5 h-3.5" /> تمديد أيام إضافية</div>
          <div className="flex gap-1">
            <Input type="number" min={1} value={extendDays} onChange={e => setExtendDays(e.target.value)} placeholder="عدد الأيام" className="h-8 text-xs" />
            <Button size="sm" className="h-8 text-xs shrink-0" disabled={!extendDays || extendMutation.isPending}
              onClick={() => {
                const n = Number(extendDays);
                if (n > 60 && !window.confirm(`تأكيد تمديد الاشتراك ${n} يوماً — هل أنت متأكد؟`)) return;
                extendMutation.mutate({ userId, days: n });
              }}>
              تمديد
            </Button>
          </div>
        </div>
      </div>

      {/* سجل المدفوعات */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 text-xs font-medium text-navy flex items-center gap-1.5">
          <Receipt className="w-3.5 h-3.5" /> سجل المدفوعات
        </div>
        <div className="max-h-48 overflow-y-auto">
          {(paymentHistory?.length ?? 0) === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">لا توجد مدفوعات بعد</div>
          ) : (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {paymentHistory?.map(p => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("ar-SA")}</td>
                    <td className="px-3 py-2">{p.purpose === "subscription" ? "اشتراك" : "شحن نقاط"}</td>
                    <td className="px-3 py-2 font-medium text-navy">{Number(p.amount).toLocaleString("ar-SA")} {p.currency}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${p.status === "paid" ? "badge-completed" : p.status === "pending" ? "badge-trial" : "badge-cancelled"}`}>
                        {p.status === "paid" ? "مدفوع" : p.status === "pending" ? "معلق" : p.status === "failed" ? "فشل" : "منتهي"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* الفواتير */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 text-xs font-medium text-navy flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> فواتير الخدمة
        </div>
        <div className="max-h-48 overflow-y-auto">
          {(invoices?.length ?? 0) === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">لا توجد فواتير بعد</div>
          ) : (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {invoices?.map(inv => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-muted-foreground">{inv.invoiceNumber}</td>
                    <td className="px-3 py-2 font-medium text-navy">{Number(inv.amount).toLocaleString("ar-SA")} {inv.currency}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded-full font-medium ${inv.status === "paid" ? "badge-completed" : inv.status === "overdue" ? "badge-cancelled" : "badge-trial"}`}>
                        {inv.status === "paid" ? "مدفوعة" : inv.status === "overdue" ? "متأخرة" : inv.status === "cancelled" ? "ملغاة" : "معلقة"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString("ar-SA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const taskTypeLabels: Record<string, string> = {
  bookkeeping: "مسك الدفاتر", invoice: "فاتورة", journal_entry: "قيد محاسبي",
  report: "تقرير", tax: "ضريبة", payroll: "رواتب", other: "أخرى",
};
const priorityLabels: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية", urgent: "عاجلة" };
const statusLabels: Record<string, string> = { pending: "معلق", in_progress: "جاري", completed: "مكتمل", cancelled: "ملغي" };
const statusColors: Record<string, string> = {
  pending: "badge-pending", in_progress: "badge-in_progress", completed: "badge-completed", cancelled: "badge-cancelled",
};
const regStatusLabels: Record<string, string> = { new: "جديد", contacted: "تم التواصل", converted: "عميل", rejected: "مرفوض" };
const regStatusColors: Record<string, string> = { new: "badge-pending", contacted: "badge-trial", converted: "badge-completed", rejected: "badge-cancelled" };
const adminActionLabels: Record<string, string> = {
  activate_subscription: "تفعيل باقة بدون دفع",
  set_subscription_status: "تغيير حالة الاشتراك",
  grant_credits: "منح نقاط",
  extend_days: "تمديد أيام",
  set_user_role: "تغيير دور مستخدم",
  set_user_active: "تفعيل/تعطيل حساب",
};

/**
 * لوحة المالك — تُعرض داخل الصفحة الرئيسية للمسؤول (Dashboard).
 * لا تحتوي على شريط جانبي ولا على بوابة صلاحيات: المُستدعي هو من يتحقق من الدور ويملك التخطيط.
 */
export function AdminConsole() {
  const { user, isAuthenticated } = useAuth();
  const [tab, setTab] = useState("registrations");
  const [expandedSubId, setExpandedSubId] = useState<number | null>(null);
  const [subSearch, setSubSearch] = useState("");
  const [usageSearch, setUsageSearch] = useState("");
  const { data: registrations } = trpc.admin.registrations.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: subscriptions } = trpc.admin.subscriptions.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: tasks } = trpc.admin.tasks.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: plans } = trpc.plans.list.useQuery();
  const { data: allUsers } = trpc.admin.users.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  // ─── استهلاك الوكلاء: لحظي ──────────────────────────────────────────────────
  const usageQuery = trpc.admin.usageSummary.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin", ...liveQueryOptions });
  const insightsQuery = trpc.admin.platformInsights.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin", ...liveQueryOptions });
  const usageSummary = usageQuery.data;
  const insights = insightsQuery.data;

  const { data: auditLog } = trpc.admin.auditLog.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" && tab === "audit" });
  const [openChatId, setOpenChatId] = useState<number | null>(null);
  const { data: customerChats } = trpc.admin.customerConversations.useQuery(undefined,
    { enabled: isAuthenticated && user?.role === "admin" && tab === "chats" });
  // الرسائل تُجلب عند الفتح فقط — كل جلب يُسجَّل في سجل التدقيق
  const { data: openChat } = trpc.admin.customerConversationMessages.useQuery(
    { conversationId: openChatId ?? 0 },
    { enabled: isAuthenticated && user?.role === "admin" && openChatId != null });
  const { data: revenueSummary } = trpc.admin.revenueSummary.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" && tab === "revenue", ...liveQueryOptions });
  const { data: llmCostSummary } = trpc.admin.llmCostSummary.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" && tab === "revenue", ...liveQueryOptions });

  // آخر لحظة وصلت فيها بيانات الاستهلاك، وحالة الجلب لأي من الاستعلامين
  const liveUpdatedAt = Math.max(usageQuery.dataUpdatedAt, insightsQuery.dataUpdatedAt);
  const liveFetching = usageQuery.isFetching || insightsQuery.isFetching;
  const refreshLive = () => { void usageQuery.refetch(); void insightsQuery.refetch(); };
  const exportQuery = trpc.admin.exportFinancialReport.useQuery(undefined, { enabled: false });
  const utils = trpc.useUtils();

  const filteredSubscriptions = subscriptions?.filter(s => {
    if (!subSearch.trim()) return true;
    const q = subSearch.trim().toLowerCase();
    return [s.companyName, s.ownerName, s.ownerEmail].some(v => v?.toLowerCase().includes(q));
  });
  const filteredUsage = usageSummary?.filter(o => {
    if (!usageSearch.trim()) return true;
    const q = usageSearch.trim().toLowerCase();
    return [o.organizationName, o.ownerName, o.ownerEmail].some(v => v?.toLowerCase().includes(q));
  });

  const handleExportCsv = async () => {
    const res = await exportQuery.refetch();
    const csv = res.data?.csv;
    if (!csv) { toast.error("لا توجد بيانات للتصدير"); return; }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financial-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const setRoleMutation = trpc.admin.setUserRole.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث دور المستخدم");
      utils.admin.users.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setActiveMutation = trpc.admin.setUserActive.useMutation({
    onSuccess: () => {
      toast.success("تم تحديث حالة المستخدم");
      utils.admin.users.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // حارس أخير: المُستدعي يتحقق من الدور، وهذا يمنع أي عرض عرضي للبيانات
  if (user?.role !== "admin") return (
    <div className="py-16 text-center">
      <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-navy">غير مصرح</h2>
      <p className="text-muted-foreground">هذه البيانات للمسؤولين فقط</p>
    </div>
  );

  return (
    <>
      <div className="flex justify-end mb-3">
        <LiveBadge updatedAt={liveUpdatedAt} isFetching={liveFetching} onRefresh={refreshLive} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "طلبات التسجيل", value: registrations?.length ?? 0, icon: <Users className="w-5 h-5" />, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "الاشتراكات النشطة", value: subscriptions?.filter(s => s.status === "active").length ?? 0, icon: <CheckCircle2 className="w-5 h-5" />, color: "text-green-600", bg: "bg-green-50" },
          { label: "إجمالي المهام", value: tasks?.length ?? 0, icon: <FileText className="w-5 h-5" />, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "مهام معلقة", value: tasks?.filter(t => t.status === "pending").length ?? 0, icon: <Clock className="w-5 h-5" />, color: "text-yellow-600", bg: "bg-yellow-50" },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <div className={`w-10 h-10 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-3`}>{s.icon}</div>
            <div className="text-2xl font-bold text-navy">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      {insights && <PlatformInsights data={insights} />}

      <div className="flex gap-2 mb-6 flex-wrap">
        {[["registrations", "طلبات التسجيل"], ["subscriptions", "الاشتراكات"], ["usage", "الاستهلاك"], ["revenue", "الإيرادات والتكلفة"], ["tasks", "المهام"], ["users", "المستخدمون"], ["chats", "محادثات العملاء"], ["audit", "سجل التدقيق"]].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 [@media(pointer:coarse)]:min-h-11 rounded-xl text-sm font-medium transition-all ${tab === v ? "bg-navy text-white shadow-md" : "bg-white text-muted-foreground border border-gray-200 hover:border-navy"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {tab === "registrations" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["الاسم", "البريد الإلكتروني", "الجوال", "الشركة", "الباقة المطلوبة", "التاريخ", "الحالة"].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {registrations?.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-navy text-sm">{r.name}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <a href={`mailto:${r.email}`} className="hover:text-navy flex items-center gap-1 transition-colors">
                        <Mail className="w-3 h-3 flex-shrink-0" />{r.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <a href={`tel:${r.phone}`} className="hover:text-navy flex items-center gap-1 transition-colors">
                        <Phone className="w-3 h-3 flex-shrink-0" />{r.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="flex items-center gap-1"><Building2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />{r.companyName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {r.planId ? (plans?.find(p => p.id === r.planId)?.nameAr ?? `#${r.planId}`) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3 flex-shrink-0" />{new Date(r.createdAt).toLocaleDateString("ar-SA")}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${regStatusColors[r.status] ?? "badge-pending"}`}>
                        {regStatusLabels[r.status] ?? r.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {(registrations?.length ?? 0) === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">لا توجد طلبات تسجيل بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === "subscriptions" && (
          <div>
            <div className="p-3 border-b border-gray-100">
              <div className="relative max-w-xs">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={subSearch} onChange={e => setSubSearch(e.target.value)} placeholder="بحث بالاسم أو البريد أو الشركة..." className="h-9 text-sm pr-9" />
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[650px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["العميل", "الباقة", "الحالة", "تاريخ البدء", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSubscriptions?.map(s => {
                  const isOpen = expandedSubId === s.id;
                  const plan = plans?.find(p => p.id === s.planId);
                  return (
                    <Fragment key={s.id}>
                      <tr className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setExpandedSubId(isOpen ? null : s.id)}>
                        <td className="px-4 py-3 text-sm">
                          <div className="font-medium text-navy">{s.companyName || s.ownerName || "—"}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="w-3 h-3 flex-shrink-0" />{s.ownerEmail ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-navy">{plan?.nameAr ?? `باقة #${s.planId}`}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === "active" ? "badge-completed" : s.status === "trial" ? "badge-trial" : "badge-cancelled"}`}>
                            {s.status === "active" ? "نشط" : s.status === "trial" ? "تجريبي" : "ملغي"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString("ar-SA")}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} className="px-4 pb-4 bg-gray-50/60">
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Building2 className="w-3.5 h-3.5" /> نوع النشاط</div>
                                <div className="text-sm font-medium text-navy">{s.companyType ?? "غير محدد"}</div>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Phone className="w-3.5 h-3.5" /> الجوال</div>
                                <div className="text-sm font-medium text-navy" dir="ltr">{s.phone ?? "غير محدد"}</div>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Hash className="w-3.5 h-3.5" /> الرقم الضريبي</div>
                                <div className="text-sm font-medium text-navy" dir="ltr">{s.vatNumber ?? "غير محدد"}</div>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Coins className="w-3.5 h-3.5" /> رصيد النقاط</div>
                                <div className="text-sm font-medium text-navy">{s.creditsBalance} نقطة</div>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3.5 h-3.5" /> دورة الفوترة</div>
                                <div className="text-sm font-medium text-navy">{s.billing === "yearly" ? "سنوية" : "شهرية"}</div>
                              </div>
                              <div className="bg-white rounded-xl p-3 border border-gray-100">
                                <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><Calendar className="w-3.5 h-3.5" /> نهاية الفترة/الدورة</div>
                                <div className="text-sm font-medium text-navy">{s.endDate ? new Date(s.endDate).toLocaleDateString("ar-SA") : "غير محدد"}</div>
                              </div>
                              {s.notes && (
                                <div className="bg-white rounded-xl p-3 border border-gray-100 sm:col-span-2 lg:col-span-3">
                                  <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1"><StickyNote className="w-3.5 h-3.5" /> ملاحظات</div>
                                  <div className="text-sm text-navy whitespace-pre-wrap">{s.notes}</div>
                                </div>
                              )}
                            </div>
                            <div className="pt-3">
                              <SubscriptionActionsPanel userId={s.userId} plans={plans} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {(filteredSubscriptions?.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">لا توجد اشتراكات مطابقة</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        )}
        {tab === "usage" && (
          <div>
            <div className="p-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div className="relative max-w-xs flex-1 min-w-[180px]">
                <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={usageSearch} onChange={e => setUsageSearch(e.target.value)} placeholder="بحث بالاسم أو البريد..." className="h-9 text-sm pr-9" />
              </div>
              <LiveBadge updatedAt={liveUpdatedAt} isFetching={liveFetching} onRefresh={refreshLive} />
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["العميل", "الباقة", "الحالة", "الرصيد المتبقي", "المستندات المستهلكة", "الرسائل المستهلكة", "إجمالي النقاط المستهلكة", "التوكنز الفعلية", "توكنز/نقطة", "تكلفة النماذج"].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredUsage?.map(o => (
                  <tr key={o.subscriptionId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-navy">{o.organizationName}</div>
                      <div className="text-xs text-muted-foreground">{o.ownerEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-navy">{o.planNameAr}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.status === "active" ? "badge-completed" : o.status === "trial" ? "badge-trial" : "badge-cancelled"}`}>
                        {o.status === "active" ? "نشط" : o.status === "trial" ? "تجريبي" : "ملغي"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">{o.creditsBalance} نقطة</td>
                    <td className="px-4 py-3 text-sm">{o.totalDocuments}</td>
                    <td className="px-4 py-3 text-sm">{o.totalMessages}</td>
                    <td className="px-4 py-3 text-sm font-medium text-navy">{o.totalCreditsConsumed} نقطة</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-navy">{o.totalTokens.toLocaleString("en-US")}</div>
                      <div className="text-[11px] text-muted-foreground" dir="ltr">
                        {o.promptTokens.toLocaleString("en-US")} in / {o.completionTokens.toLocaleString("en-US")} out · {o.llmCalls} calls
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {o.tokensPerCredit > 0
                        ? <span className="font-medium text-navy">{o.tokensPerCredit.toLocaleString("en-US")}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm" dir="ltr">
                      {o.llmCostUsd > 0
                        ? <span className="font-medium text-navy">${o.llmCostUsd.toFixed(4)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
                {(filteredUsage?.length ?? 0) === 0 && (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-muted-foreground text-sm">لا يوجد استهلاك مطابق</td></tr>
                )}
              </tbody>
              {(filteredUsage?.length ?? 0) > 0 && (() => {
                const t = (filteredUsage ?? []).reduce((a, o) => ({
                  balance: a.balance + (o.creditsBalance ?? 0),
                  docs: a.docs + o.totalDocuments,
                  msgs: a.msgs + o.totalMessages,
                  credits: a.credits + o.totalCreditsConsumed,
                  tokens: a.tokens + o.totalTokens,
                  prompt: a.prompt + o.promptTokens,
                  completion: a.completion + o.completionTokens,
                  calls: a.calls + o.llmCalls,
                  cost: a.cost + o.llmCostUsd,
                }), { balance: 0, docs: 0, msgs: 0, credits: 0, tokens: 0, prompt: 0, completion: 0, calls: 0, cost: 0 });
                const perCredit = t.credits > 0 ? Math.round(t.tokens / t.credits) : 0;
                const n = (v: number) => v.toLocaleString("en-US");
                return (
                  <tfoot className="bg-navy/5 border-t-2 border-navy/15">
                    <tr className="font-semibold text-navy">
                      <td className="px-4 py-3 text-sm">الإجمالي ({filteredUsage?.length} عميل)</td>
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3" />
                      <td className="px-4 py-3 text-sm">{n(t.balance)} نقطة</td>
                      <td className="px-4 py-3 text-sm">{n(t.docs)}</td>
                      <td className="px-4 py-3 text-sm">{n(t.msgs)}</td>
                      <td className="px-4 py-3 text-sm">{n(t.credits)} نقطة</td>
                      <td className="px-4 py-3 text-sm">
                        <div>{n(t.tokens)}</div>
                        <div className="text-[11px] font-normal text-muted-foreground" dir="ltr">
                          {n(t.prompt)} in / {n(t.completion)} out · {n(t.calls)} calls
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">{perCredit > 0 ? n(perCredit) : "—"}</td>
                      <td className="px-4 py-3 text-sm" dir="ltr">${t.cost.toFixed(4)}</td>
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
            </div>
          </div>
        )}
        {tab === "tasks" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["العنوان", "النوع", "الأولوية", "الحالة", "تاريخ الإنشاء"].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {tasks?.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-navy text-sm">{t.title}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{taskTypeLabels[t.type] ?? t.type}</td>
                    <td className="px-4 py-3 text-sm">{priorityLabels[t.priority] ?? t.priority}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[t.status] ?? "badge-pending"}`}>
                        {statusLabels[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString("ar-SA")}</td>
                  </tr>
                ))}
                {(tasks?.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">لا توجد مهام بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === "users" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["الاسم", "البريد الإلكتروني", "الدور", "آخر دخول", "تاريخ التسجيل", "إجراءات"].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allUsers?.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-navy text-sm">
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-navy/10 text-navy flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {(u.name ?? "؟").charAt(0)}
                        </span>
                        {u.name ?? "بدون اسم"}
                        {u.id === user?.id && <span className="text-xs text-muted-foreground">(أنت)</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {u.email ? (
                        <a href={`mailto:${u.email}`} className="hover:text-navy flex items-center gap-1 transition-colors">
                          <Mail className="w-3 h-3 flex-shrink-0" />{u.email}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === "admin" ? "badge-completed" : "badge-trial"}`}>
                        {u.role === "admin" ? "مسؤول" : "عميل"}
                      </span>
                      {!u.isActive && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium badge-cancelled mr-1">معطّل</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.lastSignedIn).toLocaleDateString("ar-SA")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3 flex-shrink-0" />{new Date(u.createdAt).toLocaleDateString("ar-SA")}</span>
                    </td>
                    <td className="px-4 py-3">
                      {u.id !== user?.id ? (
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            disabled={setRoleMutation.isPending}
                            onClick={() => setRoleMutation.mutate({ userId: u.id, role: u.role === "admin" ? "user" : "admin" })}
                          >
                            {u.role === "admin" ? "تحويل إلى عميل" : "ترقية إلى مسؤول"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`text-xs h-7 ${u.isActive ? "text-red-600 border-red-200 hover:bg-red-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}
                            disabled={setActiveMutation.isPending}
                            onClick={() => setActiveMutation.mutate({ userId: u.id, isActive: !u.isActive })}
                          >
                            {u.isActive ? "تعطيل" : "إعادة تفعيل"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(allUsers?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">لا يوجد مستخدمون بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === "revenue" && (
          <div className="p-4 space-y-6">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="text-xs h-8 gap-1" onClick={handleExportCsv} disabled={exportQuery.isFetching}>
                <Download className="w-3.5 h-3.5" /> تصدير تقرير مالي (CSV)
              </Button>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center mb-3"><TrendingUp className="w-5 h-5" /></div>
                <div className="text-2xl font-bold text-navy">{(revenueSummary?.totalPaidRevenue ?? 0).toLocaleString("ar-SA")} ريال</div>
                <div className="text-sm text-muted-foreground">إجمالي الإيرادات الفعلية المحصّلة</div>
                <div className="text-[11px] text-muted-foreground mt-1">صافٍ بعد استبعاد ضريبة القيمة المضافة</div>
              </div>
              {/* الضريبة المحصَّلة ليست إيراداً — تُعرض منفصلة كرقم مرجعي للإقرار */}
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3"><Receipt className="w-5 h-5" /></div>
                <div className="text-2xl font-bold text-navy">{(revenueSummary?.vatThisQuarter ?? 0).toLocaleString("ar-SA")} ريال</div>
                <div className="text-sm text-muted-foreground">ضريبة محصّلة — الربع الجاري</div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  مستحقة للهيئة، ليست إيراداً
                  {revenueSummary?.vatQuarterStart ? ` · منذ ${String(revenueSummary.vatQuarterStart).slice(0, 10)}` : ""}
                </div>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-yellow-50 text-yellow-600 flex items-center justify-center mb-3"><Gift className="w-5 h-5" /></div>
                <div className="text-2xl font-bold text-navy">{(revenueSummary?.totalAdminGrantsValue ?? 0).toLocaleString("ar-SA")} ريال</div>
                <div className="text-sm text-muted-foreground">قيمة المنح الإدارية المجانية</div>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3"><Cpu className="w-5 h-5" /></div>
                <div className="text-2xl font-bold text-navy">${(llmCostSummary?.today ?? 0).toFixed(4)}</div>
                <div className="text-sm text-muted-foreground">تكلفة النماذج (آخر 24 ساعة)</div>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3"><DollarSign className="w-5 h-5" /></div>
                <div className="text-2xl font-bold text-navy">${(llmCostSummary?.last30Days ?? 0).toFixed(4)}</div>
                <div className="text-sm text-muted-foreground">تكلفة النماذج (آخر 30 يوماً)</div>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm sm:col-span-2 lg:col-span-4">
                <div className="text-sm text-muted-foreground">
                  هامش تقديري للشهر الحالي: إيرادات الشهر {(revenueSummary?.byMonth[0]?.paidRevenue ?? 0).toLocaleString("ar-SA")} ريال
                  − تكلفة نماذج آخر 30 يوماً {((llmCostSummary?.last30Days ?? 0) * 3.75).toFixed(2)} ريال (بسعر صرف تقريبي 3.75 ريال/دولار)
                </div>
                <div className="text-xl font-bold text-navy mt-1">
                  {((revenueSummary?.byMonth[0]?.paidRevenue ?? 0) - (llmCostSummary?.last30Days ?? 0) * 3.75).toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ريال
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-navy flex items-center gap-2">
                <Cpu className="w-4 h-4" /> تكلفة النماذج الذكية حسب الموديل (تحديث كل 30 ثانية)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>{["الموديل", "المزود", "عدد الاستدعاءات", "إجمالي التوكنز", "التكلفة (دولار)"].map(h => (
                      <th key={h} className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {llmCostSummary?.byModel.map(m => (
                      <tr key={`${m.provider}-${m.model}`}>
                        <td className="px-4 py-2 font-medium text-navy" dir="ltr">{m.model}</td>
                        <td className="px-4 py-2 text-muted-foreground">{m.provider}</td>
                        <td className="px-4 py-2">{m.calls.toLocaleString("ar-SA")}</td>
                        <td className="px-4 py-2">{m.totalTokens.toLocaleString("ar-SA")}</td>
                        <td className="px-4 py-2 font-medium text-navy">${m.costUsd.toFixed(4)}</td>
                      </tr>
                    ))}
                    {(llmCostSummary?.byModel.length ?? 0) === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-sm">لا يوجد استهلاك مسجَّل بعد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-navy flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> الإيرادات مقابل المنح الإدارية (آخر 12 شهراً)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px] text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>{["الشهر", "إيرادات فعلية", "قيمة منح مجانية"].map(h => (
                      <th key={h} className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {revenueSummary?.byMonth.map(m => (
                      <tr key={m.month}>
                        <td className="px-4 py-2 font-medium text-navy" dir="ltr">{m.month}</td>
                        <td className="px-4 py-2">{m.paidRevenue.toLocaleString("ar-SA")} ريال</td>
                        <td className="px-4 py-2 text-muted-foreground">{m.grantsValue.toLocaleString("ar-SA")} ريال</td>
                      </tr>
                    ))}
                    {(revenueSummary?.byMonth.length ?? 0) === 0 && (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground text-sm">لا توجد بيانات بعد</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {tab === "chats" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              محادثات العملاء تحتوي بياناتهم المالية. كل فتح لمحادثة يُسجَّل باسمك في سجل التدقيق.
            </div>
            {!openChatId && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-right">
                      <tr>
                        <th className="p-3 font-medium">المحادثة</th>
                        <th className="p-3 font-medium">العميل</th>
                        <th className="p-3 font-medium">رسائل</th>
                        <th className="p-3 font-medium">آخر نشاط</th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {(customerChats ?? []).map(c => (
                        <tr key={c.id} className="border-t border-gray-50">
                          <td className="p-3">{c.title}</td>
                          <td className="p-3">
                            <div>{c.orgName ?? c.ownerName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{c.ownerEmail}</div>
                          </td>
                          <td className="p-3">{c.messageCount}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {new Date(c.updatedAt).toLocaleString("ar-SA")}
                          </td>
                          <td className="p-3">
                            <Button size="sm" variant="outline" className="text-xs"
                              onClick={() => setOpenChatId(c.id)}>عرض</Button>
                          </td>
                        </tr>
                      ))}
                      {customerChats && customerChats.length === 0 && (
                        <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد محادثات بعد</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {openChatId && (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold text-navy truncate">{openChat?.title ?? "..."}</div>
                    <div className="text-xs text-muted-foreground">
                      {openChat?.owner.orgName ?? openChat?.owner.name} · {openChat?.owner.email}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="text-xs shrink-0"
                    onClick={() => setOpenChatId(null)}>رجوع للقائمة</Button>
                </div>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {(openChat?.messages ?? []).map(m => (
                    <div key={m.id} className={m.role === "user" ? "text-right" : "text-right"}>
                      <div className={`inline-block max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.role === "user" ? "bg-navy text-white" : "bg-gray-100 text-foreground"
                      }`}>{m.content}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {new Date(m.createdAt).toLocaleString("ar-SA")}
                      </div>
                    </div>
                  ))}
                  {openChat && openChat.messages.length === 0 && (
                    <p className="text-center text-muted-foreground py-6">لا رسائل في هذه المحادثة</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "audit" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[750px]">
              <thead className="bg-gray-50 border-b">
                <tr>{["التاريخ", "المسؤول", "الإجراء", "العميل المستهدف", "التفاصيل"].map(h => (
                  <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {auditLog?.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString("ar-SA")}</td>
                    <td className="px-4 py-3 text-sm font-medium text-navy">{a.adminName ?? `#${a.adminId}`}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium badge-trial">{adminActionLabels[a.action] ?? a.action}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{a.targetUserEmail ?? `#${a.targetUserId}`}</td>
                    <td className="px-4 py-3 text-sm text-navy">{a.details ?? "—"}</td>
                  </tr>
                ))}
                {(auditLog?.length ?? 0) === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">لا توجد إجراءات مسجَّلة بعد</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── تحليلات المنصة (لوحة المالك) ──────────────────────────────────────────────
type InsightsData = inferRouterOutputs<AppRouter>["admin"]["platformInsights"];

// ألوان المخطط — تم التحقق منها آلياً لعمى الألوان والتباين (protan ΔE 24.7 · normal ΔE 33.6 · تباين ≥ 3:1)
const SERIES_PAID = "#2a78d6";
const SERIES_GRANTS = "#eb6834";
const CHART_SURFACE = "#ffffff";
const CHART_GRID = "#eef1f5";
const CHART_AXIS_INK = "#94a3b8";
const CHART_LABEL_INK = "#334155";

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
/** "2026-07" → "يوليو 26" */
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS_AR[Number(m) - 1] ?? m} ${y?.slice(2) ?? ""}`;
}
const compactSar = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v)));

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; stroke?: string }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-lg px-3 py-2 text-xs min-w-[170px]">
      <div className="font-semibold text-navy mb-1.5">{label}</div>
      {payload.map(p => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.stroke }} aria-hidden="true" />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold text-navy ms-auto" style={{ fontVariantNumeric: "tabular-nums" }}>
            {Number(p.value ?? 0).toLocaleString("en-US")} ر.س
          </span>
        </div>
      ))}
    </div>
  );
}

/** الإيراد المحصّل مقابل قيمة المنح الإدارية، شهرياً — بيانات تغيّر عبر الزمن، فالشكل خط */
function RevenueTrendChart({ byMonth }: { byMonth: InsightsData["finance"]["byMonth"] }) {
  // المصدر يرجع الأحدث أولاً؛ نعكسه ليقرأ الزمن تصاعدياً ثم نعكس المحور ليبدأ الأقدم من اليمين
  const data = [...byMonth].reverse().map(r => ({ ...r, label: monthLabel(r.month) }));

  // خط بنقطة واحدة لا يرسم اتجاهاً — نوضّح السبب بدل إخفاء البطاقة بصمت
  if (data.length < 2) {
    return (
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <h3 className="font-semibold text-navy mb-1">الإيراد الشهري مقابل المنح</h3>
        <p className="text-[11.5px] text-muted-foreground">
          {data.length === 0
            ? "لا توجد مدفوعات مسجّلة بعد — سيظهر المخطط تلقائياً بعد أول عملية دفع."
            : `البيانات المتاحة شهر واحد فقط (${data[0].label}) — يحتاج المخطط شهرين على الأقل ليُظهر اتجاهاً.`}
        </p>
      </div>
    );
  }

  const lastIndex = data.length - 1;
  const latest = data[lastIndex];
  const peak = Math.max(...data.flatMap(d => [d.paidRevenue, d.grantsValue]), 1);
  // عند تقارب نهايتَي الخطين تتداخل التسميات المباشرة — عندها نكتفي بالمفتاح والتلميح
  const endLabelsFit = Math.abs(latest.paidRevenue - latest.grantsValue) > peak * 0.1;

  const endLabel = (props: { x?: number; y?: number; index?: number; value?: number }) => {
    if (!endLabelsFit || props.index !== lastIndex) return <g />;
    return (
      <text x={(props.x ?? 0) + 6} y={(props.y ?? 0) - 10} fill={CHART_LABEL_INK} fontSize={11} fontWeight={600} textAnchor="start">
        {compactSar(Number(props.value ?? 0))}
      </text>
    );
  };

  const series = [
    { key: "paidRevenue", name: "الإيراد المحصّل", color: SERIES_PAID },
    { key: "grantsValue", name: "قيمة المنح الإدارية", color: SERIES_GRANTS },
  ];

  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 mb-1">
        <h3 className="font-semibold text-navy">الإيراد الشهري مقابل المنح</h3>
        {/* مفتاح دائم: الهوية لا تعتمد على اللون وحده */}
        <div className="flex items-center gap-4">
          {series.map(s => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className="w-4 h-[2px] rounded-full shrink-0" style={{ background: s.color }} aria-hidden="true" />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <p className="text-[11.5px] text-muted-foreground mb-4">
        آخر {data.length} شهراً بالريال — المحصّل فعلياً مقابل ما مُنح إدارياً بدون تحصيل.
      </p>

      <div className="h-64 -mx-2" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={CHART_GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label" reversed
              tick={{ fill: CHART_AXIS_INK, fontSize: 11 }}
              tickLine={false} axisLine={{ stroke: CHART_GRID }} interval="preserveStartEnd" minTickGap={12}
            />
            <YAxis
              orientation="right" width={52}
              tick={{ fill: CHART_AXIS_INK, fontSize: 11 }}
              tickLine={false} axisLine={false} tickFormatter={compactSar}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_AXIS_INK, strokeWidth: 1 }} />
            {series.map(s => (
              <Line
                key={s.key} type="monotone" dataKey={s.key} name={s.name}
                stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                dot={{ r: 3, fill: s.color, stroke: CHART_SURFACE, strokeWidth: 2 }}
                activeDot={{ r: 5, fill: s.color, stroke: CHART_SURFACE, strokeWidth: 2 }}
                label={endLabel}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* عرض جدولي: نفس الأرقام بلا اعتماد على اللون أو التحويم */}
      <details className="mt-3">
        <summary className="text-[11.5px] text-muted-foreground cursor-pointer hover:text-navy transition-colors">عرض الأرقام كجدول</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="border-b border-gray-100">
              <tr>{["الشهر", "الإيراد المحصّل", "قيمة المنح"].map(h => (
                <th key={h} className="px-2 py-1.5 text-right font-medium text-muted-foreground">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...data].reverse().map(r => (
                <tr key={r.month}>
                  <td className="px-2 py-1.5 text-navy">{r.label}</td>
                  <td className="px-2 py-1.5 text-navy">{r.paidRevenue.toLocaleString("en-US")}</td>
                  <td className="px-2 py-1.5 text-navy">{r.grantsValue.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

const ADVICE_STYLE: Record<string, { box: string; dot: string; label: string }> = {
  critical: { box: "border-red-200 bg-red-50", dot: "bg-red-500", label: "text-red-900" },
  warning: { box: "border-amber-200 bg-amber-50", dot: "bg-amber-500", label: "text-amber-900" },
  info: { box: "border-blue-200 bg-blue-50", dot: "bg-blue-500", label: "text-blue-900" },
  good: { box: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500", label: "text-emerald-900" },
};

function PlatformInsights({ data }: { data: InsightsData }) {
  const n = (v: number) => v.toLocaleString("en-US");
  const sar = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س`;
  const { customers, usage, finance, advice } = data;
  const profitPositive = finance.netProfitSar >= 0;

  return (
    <div className="mb-8 space-y-4">
      {/* العملاء والاستهلاك */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="text-xs text-muted-foreground mb-1">إجمالي العملاء</div>
          <div className="text-2xl font-bold text-navy">{n(customers.total)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {customers.active} نشط · {customers.trial} تجريبي · {customers.inactive} متوقف
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="text-xs text-muted-foreground mb-1">المستخدمون</div>
          <div className="text-2xl font-bold text-navy">{n(data.totalUsers)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">شامل المستخدمين الفرعيين</div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="text-xs text-muted-foreground mb-1">النقاط المستهلكة</div>
          <div className="text-2xl font-bold text-navy">{n(usage.totalCredits)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {n(usage.totalDocuments)} مستند · {n(usage.totalMessages)} رسالة
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <div className="text-xs text-muted-foreground mb-1">التوكنز المستهلكة</div>
          <div className="text-2xl font-bold text-navy">{n(usage.totalTokens)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {n(usage.avgTokensPerCredit)} توكن/نقطة · {n(usage.totalCalls)} استدعاء
          </div>
        </div>
      </div>

      {/* الربحية */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <h3 className="font-semibold text-navy mb-4">الربحية</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">الإيراد المحصّل</div>
            <div className="text-xl font-bold text-navy mt-0.5">{sar(finance.paidRevenueSar)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">تكلفة النماذج</div>
            <div className="text-xl font-bold text-navy mt-0.5">{sar(finance.modelCostSar)}</div>
            <div className="text-[11px] text-muted-foreground" dir="ltr">${finance.modelCostUsd}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">صافي الربح</div>
            <div className={`text-xl font-bold mt-0.5 ${profitPositive ? "text-emerald-600" : "text-red-600"}`}>
              {sar(finance.netProfitSar)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">هامش الربح</div>
            <div className={`text-xl font-bold mt-0.5 ${finance.marginPct >= 50 ? "text-emerald-600" : finance.marginPct > 0 ? "text-amber-600" : "text-red-600"}`}>
              {finance.marginPct}%
            </div>
            <div className="text-[11px] text-muted-foreground">
              تكلفة النقطة ≈ {finance.costPerCreditSar} ر.س
            </div>
          </div>
        </div>
        {finance.adminGrantsValueSar > 0 && (
          <p className="text-[11.5px] text-muted-foreground mt-3 pt-3 border-t border-gray-100">
            قيمة الاشتراكات الممنوحة إدارياً (غير محصّلة): <strong className="text-navy">{sar(finance.adminGrantsValueSar)}</strong>
          </p>
        )}
      </div>

      {/* اتجاه الإيراد شهرياً */}
      <RevenueTrendChart byMonth={finance.byMonth} />

      {/* نصائح */}
      {advice.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <h3 className="font-semibold text-navy mb-1">قراءة الأرقام ونصائح</h3>
          <p className="text-[11.5px] text-muted-foreground mb-4">مبنية على أرقام حسابك الفعلية — كل نصيحة تذكر الرقم الذي بُنيت عليه.</p>
          <div className="space-y-2.5">
            {advice.map((a, i) => {
              const st = ADVICE_STYLE[a.severity] ?? ADVICE_STYLE.info;
              return (
                <div key={i} className={`rounded-xl border p-3 ${st.box}`}>
                  <div className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${st.dot}`} />
                    <div>
                      <div className={`text-sm font-semibold ${st.label}`}>{a.title}</div>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground mt-0.5">{a.detail}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
