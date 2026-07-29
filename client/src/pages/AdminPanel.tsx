import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users, FileText, CheckCircle2, Shield, Clock, Building2, Phone, Mail, Calendar, Zap,
  ChevronDown, ChevronUp, Coins, Hash, StickyNote, Gift, PlusCircle, CalendarPlus, Receipt, Ban,
} from "lucide-react";
import { useState, Fragment } from "react";
import { toast } from "sonner";

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
              onClick={() => creditsMutation.mutate({ userId, credits: Number(creditsAmount) })}>
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
              onClick={() => extendMutation.mutate({ userId, days: Number(extendDays) })}>
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

export default function AdminPanel() {
  const { user, isAuthenticated, loading } = useAuth();
  const [tab, setTab] = useState("registrations");
  const [expandedSubId, setExpandedSubId] = useState<number | null>(null);
  const { data: registrations } = trpc.admin.registrations.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: subscriptions } = trpc.admin.subscriptions.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: tasks } = trpc.admin.tasks.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: plans } = trpc.plans.list.useQuery();
  const { data: allUsers } = trpc.admin.users.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const { data: usageSummary } = trpc.admin.usageSummary.useQuery(undefined, { enabled: isAuthenticated && user?.role === "admin" });
  const utils = trpc.useUtils();
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

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;
  if (user?.role !== "admin") return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-navy">غير مصرح</h2>
        <p className="text-muted-foreground">هذه الصفحة للمسؤولين فقط</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/admin" />
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">لوحة الإدارة</h1>
          <p className="text-muted-foreground mt-1">إدارة العملاء والاشتراكات والمهام</p>
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

        <div className="flex gap-2 mb-6 flex-wrap">
          {[["registrations", "طلبات التسجيل"], ["subscriptions", "الاشتراكات"], ["usage", "الاستهلاك"], ["tasks", "المهام"], ["users", "المستخدمون"]].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === v ? "bg-navy text-white" : "bg-white text-muted-foreground border border-gray-200 hover:border-navy"}`}>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px]">
                <thead className="bg-gray-50 border-b">
                  <tr>{["العميل", "الباقة", "الحالة", "تاريخ البدء", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {subscriptions?.map(s => {
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
                  {(subscriptions?.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground text-sm">لا توجد اشتراكات بعد</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {tab === "usage" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px]">
                <thead className="bg-gray-50 border-b">
                  <tr>{["العميل", "الباقة", "الحالة", "الرصيد المتبقي", "المستندات المستهلكة", "الرسائل المستهلكة", "إجمالي النقاط المستهلكة"].map(h => (
                    <th key={h} className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {usageSummary?.map(o => (
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
                    </tr>
                  ))}
                  {(usageSummary?.length ?? 0) === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">لا يوجد استهلاك بعد</td></tr>
                  )}
                </tbody>
              </table>
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
        </div>
      </main>
    </div>
  );
}
