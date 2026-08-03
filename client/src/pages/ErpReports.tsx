import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertCircle, BarChart3, DollarSign, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** اللون يصف الرقم: ذهبي لما يدخل، وأخضر لما حُصّل، وكهرماني لما ينتظر */
function KpiBox({ title, value, subtitle, icon: Icon, tone = "plain" }: {
  title: string; value: string; subtitle: string; icon: React.ElementType;
  tone?: "plain" | "accent" | "ok" | "warn";
}) {
  const iconClass = { plain: "m-icon", accent: "m-icon m-icon--accent", ok: "m-icon m-icon--ok", warn: "m-icon m-icon--warn" }[tone];
  return (
    <div className="m-card flex items-center gap-3">
      <span className={`${iconClass} shrink-0`}><Icon className="w-5 h-5" /></span>
      <div className="min-w-0">
        <p className="m-stat__label">{title}</p>
        <p className="text-lg font-bold text-navy truncate">{value}</p>
        <p className="m-stat__label">{subtitle}</p>
      </div>
    </div>
  );
}

// ألوان الرسوم: recharts يرسم على SVG بقيم صريحة لا بأصناف Tailwind، فتُجمع
// هنا بأسماء تقول وظيفتها ليمرّ تغييرُها بموضع واحد.
const CHART_GRID = "#e2e8f0";
const CHART_TEAL = "#0d9488";
const STATUS_PAID = "#10b981";
const STATUS_UNPAID = "#ef4444";
const STATUS_OTHER = "#94a3b8";

export default function ErpReports() {
  const { data: stats, isLoading, error, refetch } =
    trpc.erpnext.getDashboardStats.useQuery(undefined, { staleTime: 60 * 1000 });

  const { data: invoicesData } = trpc.erpnext.getSalesInvoices.useQuery({ limit: 100 }, { staleTime: 60 * 1000 });

  const invoices = (invoicesData?.data ?? []) as Array<{
    name: string; customer: string; posting_date: string; grand_total: number; status: string;
  }>;

  // تجميع المبيعات حسب الشهر
  const monthlyMap = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.posting_date) continue;
    const month = inv.posting_date.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (inv.grand_total ?? 0));
  }
  const monthlyData = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, total]) => ({ month, total }));

  // تجميع حسب العميل (أعلى 5)
  const customerMap = new Map<string, number>();
  for (const inv of invoices) {
    customerMap.set(inv.customer, (customerMap.get(inv.customer) ?? 0) + (inv.grand_total ?? 0));
  }
  const topCustomers = Array.from(customerMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([customer, total]) => ({ customer, total }));

  const pieData = stats ? [
    { name: "مدفوعة", value: stats.paidInvoices, color: STATUS_PAID },
    { name: "غير مدفوعة", value: stats.unpaidInvoices, color: STATUS_UNPAID },
    { name: "أخرى", value: Math.max(0, stats.totalInvoices - stats.paidInvoices - stats.unpaidInvoices), color: STATUS_OTHER },
  ].filter(d => d.value > 0) : [];

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              التقارير المالية
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">ملخص الأداء المالي والمبيعات</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5 h-8 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <p className="text-sm text-destructive">تعذّر جلب البيانات: {error.message}</p>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiBox title="إجمالي الإيرادات" value={stats.totalRevenue.toLocaleString("ar-SA")} subtitle="ريال عماني" icon={DollarSign} tone="accent" />
            <KpiBox title="المحصّل" value={stats.paidRevenue.toLocaleString("ar-SA")} subtitle="إيرادات مدفوعة" icon={TrendingUp} tone="ok" />
            <KpiBox title="غير المحصّل" value={(stats.totalRevenue - stats.paidRevenue).toLocaleString("ar-SA")} subtitle="ذمم مدينة" icon={AlertCircle} tone="warn" />
            <KpiBox title="عدد الفواتير" value={String(stats.totalInvoices)} subtitle={`${stats.unpaidInvoices} غير مدفوعة`} icon={FileText} tone="plain" />
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">المبيعات الشهرية</CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">لا توجد بيانات كافية</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v.toLocaleString("ar-SA")} ر.ع`, "المبيعات"]} />
                    <Bar dataKey="total" fill={CHART_TEAL} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">حالة الفواتير</CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">لا توجد بيانات</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      {/* بلا تسميات على الشرائح: recharts يلوّنها بلون الشريحة نفسها،
                          فتصير أخضر/رمادي على أبيض بتباين 2.5:1. المفتاح تحت يحمل الهوية. */}
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="#fff" strokeWidth={2} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-2">
                    {pieData.map(d => (
                      <li key={d.name} className="flex items-center gap-1.5 text-xs text-foreground">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} aria-hidden="true" />
                        {d.name}
                        <span className="font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{d.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">أعلى 5 عملاء بالمبيعات</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topCustomers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا توجد بيانات</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-right p-3 font-medium">العميل</th>
                    <th className="text-right p-3 font-medium">إجمالي المبيعات</th>
                  </tr>
                </thead>
                <tbody>
                  {topCustomers.map(c => (
                    <tr key={c.customer} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                      <td className="p-3 font-medium">{c.customer}</td>
                      <td className="p-3 font-semibold">{c.total.toLocaleString("ar-SA")} ر.ع</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
