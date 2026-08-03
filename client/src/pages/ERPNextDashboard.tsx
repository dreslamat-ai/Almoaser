import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Users, FileText, Package,
  DollarSign, AlertCircle, ArrowUpRight, Bot, Settings,
  RefreshCw, ShoppingCart, CheckCircle2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useState } from "react";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    Paid: { label: "مدفوعة", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    Unpaid: { label: "غير مدفوعة", className: "bg-red-100 text-red-700 border-red-200" },
    Overdue: { label: "متأخرة", className: "bg-orange-100 text-orange-700 border-orange-200" },
    Draft: { label: "مسودة", className: "bg-gray-100 text-gray-600 border-gray-200" },
    Cancelled: { label: "ملغاة", className: "bg-gray-100 text-gray-500 border-gray-200" },
    Return: { label: "مرتجع", className: "bg-purple-100 text-purple-700 border-purple-200" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

/**
 * بطاقة رقم.
 *
 * **اللون هنا معنى لا زينة.** كانت كل بطاقة بلونها — زمردي وأزرق وبنفسجي
 * وكهرماني متجاورة — فلا يدلّ اللون على شيء وتُقرأ العناوين في كل مرة.
 * صار اللون يصف الرقم: ذهبي لما يدخل، وأخضر لما تمّ، وكهرماني لما ينتظر،
 * وكحلي لما هو عدٌّ مجرّد.
 *
 * والبطاقة التي تُفتح ترتفع عند المرور، والساكنة لا — فيُفرَّق بينهما قبل
 * أن تُقرأ.
 */
function KpiCard({
  title, value, subtitle, icon: Icon, tone = "plain", loading, onClick,
}: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; tone?: "plain" | "accent" | "ok" | "warn"; loading?: boolean; onClick?: () => void;
}) {
  const iconClass = { plain: "m-icon", accent: "m-icon m-icon--accent", ok: "m-icon m-icon--ok", warn: "m-icon m-icon--warn" }[tone];
  return (
    <div
      className={`m-card ${onClick ? "m-card--action cursor-pointer" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }) : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="m-stat__label mb-2">{title}</p>
          {loading ? <Skeleton className="h-7 w-20 mb-1" /> : <p className="m-stat">{value}</p>}
          {subtitle && !loading && <p className="m-stat__label mt-1.5">{subtitle}</p>}
        </div>
        <span className={`${iconClass} shrink-0`}><Icon className="w-5 h-5" /></span>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium text-foreground mb-1">{label}</p>
      <p className="text-primary font-semibold">{(payload[0]?.value ?? 0).toLocaleString("ar-SA")} ر.ع</p>
    </div>
  );
}

// ─── ألوان الرسوم ────────────────────────────────────────────────────────
// recharts يرسم على SVG بقيم لونية صريحة لا بأصناف Tailwind، فلا سبيل إلى
// تمرير متغيّرات الهوية إليه مباشرة. تُجمع هنا بأسماء تقول وظيفتها، فتغيير
// الهوية يمرّ بموضع واحد بدل أن يُطارَد في كل خاصية داخل الملف.
const CHART_NAVY = "#22335a";        // = --color-navy
const CHART_GRID = "#e2e8f0";
const CHART_AXIS_INK = "#94a3b8";
const STATUS_PAID = "#10b981";
const STATUS_UNPAID = "#ef4444";
const STATUS_OTHER = CHART_AXIS_INK;

export default function ERPNextDashboard() {
  const [, setLocation] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);
  const { isAuthenticated } = useAuth();

  const { data: stats, isLoading: statsLoading, error: statsError, refetch } =
    trpc.erpnext.getDashboardStats.useQuery(undefined, { staleTime: 3 * 60 * 1000, retry: 1, enabled: isAuthenticated });

  const { data: invoicesData, isLoading: invoicesLoading } =
    trpc.erpnext.getSalesInvoices.useQuery({ limit: 6 }, { staleTime: 3 * 60 * 1000, enabled: isAuthenticated });

  const { data: customersData, isLoading: customersLoading } =
    trpc.erpnext.getCustomers.useQuery({ limit: 5 }, { staleTime: 3 * 60 * 1000, enabled: isAuthenticated });

  const invoices = (invoicesData?.data ?? []) as Array<{
    name: string; customer: string; posting_date: string;
    grand_total: number; outstanding_amount: number; status: string; currency: string;
  }>;

  const customers = (customersData?.data ?? []) as Array<{
    name: string; customer_name: string; customer_type: string; mobile_no: string; email_id: string;
  }>;

  const pieData = stats ? [
    { name: "مدفوعة", value: stats.paidInvoices, color: STATUS_PAID },
    { name: "غير مدفوعة", value: stats.unpaidInvoices, color: STATUS_UNPAID },
    { name: "أخرى", value: Math.max(0, stats.totalInvoices - stats.paidInvoices - stats.unpaidInvoices), color: STATUS_OTHER },
  ].filter(d => d.value > 0) : [];

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    void refetch();
  };

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-7xl mx-auto" key={refreshKey}>

        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground">لوحة التحكم</h1>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">نظرة عامة على أداء الشركة · demo.almoaser.cloud</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1.5 h-8 text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              تحديث
            </Button>
            <Button size="sm" onClick={() => setLocation("/agent")} className="gap-1.5 h-8 text-xs">
              <Bot className="w-3.5 h-3.5" />
              المحاسب الذكي
            </Button>
          </div>
        </div>

        {/* Error */}
        {statsError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <div>
                <p className="font-medium text-destructive text-sm">تعذّر الاتصال بـ Almoaser AI ERP</p>
                <p className="text-xs text-muted-foreground mt-0.5">{statsError.message}</p>
              </div>
              <Button variant="outline" size="sm" className="mr-auto" onClick={handleRefresh}>إعادة المحاولة</Button>
            </CardContent>
          </Card>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            title="إجمالي الإيرادات"
            value={stats ? `${stats.totalRevenue.toLocaleString("ar-SA")}` : "—"}
            subtitle={`${stats?.paidRevenue?.toLocaleString("ar-SA") ?? "—"} ر.ع محصّل`}
            icon={DollarSign} tone="accent" loading={statsLoading}
          />
          <KpiCard
            title="الفواتير"
            value={stats?.totalInvoices ?? "—"}
            subtitle={`${stats?.unpaidInvoices ?? "—"} غير مدفوعة`}
            icon={FileText} tone="plain" loading={statsLoading}
            onClick={() => setLocation("/erp/invoices")}
          />
          <KpiCard
            title="العملاء"
            value={stats?.totalCustomers ?? "—"}
            subtitle="إجمالي العملاء المسجلين"
            icon={Users} tone="plain" loading={statsLoading}
            onClick={() => setLocation("/erp/customers")}
          />
          <KpiCard
            title="الموردون / الأصناف"
            value={stats ? `${stats.totalSuppliers} / ${stats.totalItems}` : "—"}
            subtitle="موردون / أصناف مسجلة"
            icon={Package} tone="warn" loading={statsLoading}
          />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Area Chart */}
          <Card className="lg:col-span-2 shadow-sm">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                الإيرادات الشهرية
              </CardTitle>
              <CardDescription className="text-xs">آخر 6 أشهر (ر.ع)</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {statsLoading ? (
                <Skeleton className="h-44 w-full rounded-lg" />
              ) : stats?.monthlyRevenue?.length ? (
                <ResponsiveContainer width="100%" height={176}>
                  <AreaChart data={stats.monthlyRevenue} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_NAVY} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={CHART_NAVY} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: CHART_AXIS_INK }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_AXIS_INK }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="amount" stroke={CHART_NAVY} strokeWidth={2.5} fill="url(#grad)" dot={{ r: 3, fill: CHART_NAVY }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <TrendingDown className="w-8 h-8 opacity-30" />
                  <p className="text-sm">لا توجد بيانات إيرادات بعد</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pie Chart */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />
                حالة الفواتير
              </CardTitle>
              <CardDescription className="text-xs">توزيع الفواتير حسب الحالة</CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {statsLoading ? (
                <Skeleton className="h-44 w-full rounded-lg" />
              ) : pieData.length > 0 ? (
                <div className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={140}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={62} paddingAngle={3} dataKey="value">
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [`${v} فاتورة`, ""]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-3 mt-1">
                    {pieData.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                        <span>{d.name}</span>
                        <span className="font-semibold text-foreground">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-44 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <FileText className="w-8 h-8 opacity-30" />
                  <p className="text-sm">لا توجد فواتير بعد</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tables Row */}
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Recent Invoices */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">آخر الفواتير</CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-primary px-2" onClick={() => setLocation("/erp/invoices")}>
                  عرض الكل <ArrowUpRight className="w-3 h-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {invoicesLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <FileText className="w-9 h-9 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">لا توجد فواتير بعد</p>
                  <Button size="sm" variant="outline" onClick={() => setLocation("/agent")} className="gap-1.5 mt-1 text-xs">
                    <Bot className="w-3.5 h-3.5" /> إنشاء فاتورة عبر المحاسب الذكي
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {invoices.map(inv => (
                    <div key={inv.name} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-foreground truncate max-w-[120px]">{inv.customer || inv.name}</p>
                          <StatusBadge status={inv.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{inv.name} · {inv.posting_date}</p>
                      </div>
                      <div className="text-right shrink-0 mr-2">
                        <p className="text-sm font-semibold">{(inv.grand_total ?? 0).toLocaleString("ar-SA")}</p>
                        <p className="text-xs text-muted-foreground">{inv.currency ?? "OMR"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customers */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">العملاء</CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1 text-primary px-2" onClick={() => setLocation("/erp/customers")}>
                  عرض الكل <ArrowUpRight className="w-3 h-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {customersLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}</div>
              ) : customers.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Users className="w-9 h-9 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">لا يوجد عملاء بعد</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {customers.map(c => (
                    <div key={c.name} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-primary">{(c.customer_name || c.name).charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{c.customer_name || c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.mobile_no || c.email_id || "—"}</p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.customer_type === "Company" ? "شركة" : c.customer_type === "Individual" ? "فرد" : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        {/* بطاقات الاختصار حُذفت — القائمة الجانبية وحدها تُوصل، ومكانان
          للوصول إلى الشيء نفسه يجعلان المستخدم يختار بدل أن يضغط */}

      </div>
    </DashboardLayout>
  );
}
