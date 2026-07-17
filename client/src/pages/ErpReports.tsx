import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertCircle, BarChart3, DollarSign, FileText, RefreshCw, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function KpiBox({ title, value, subtitle, icon: Icon, color }: {
  title: string; value: string; subtitle: string; icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center text-white shrink-0`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-lg font-bold truncate">{value}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </CardContent>
    </Card>
  );
}

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
    { name: "مدفوعة", value: stats.paidInvoices, color: "#10b981" },
    { name: "غير مدفوعة", value: stats.unpaidInvoices, color: "#ef4444" },
    { name: "أخرى", value: Math.max(0, stats.totalInvoices - stats.paidInvoices - stats.unpaidInvoices), color: "#94a3b8" },
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
            <KpiBox title="إجمالي الإيرادات" value={stats.totalRevenue.toLocaleString("ar-SA")} subtitle="ريال عماني" icon={DollarSign} color="bg-emerald-500" />
            <KpiBox title="المحصّل" value={stats.paidRevenue.toLocaleString("ar-SA")} subtitle="إيرادات مدفوعة" icon={TrendingUp} color="bg-blue-500" />
            <KpiBox title="غير المحصّل" value={(stats.totalRevenue - stats.paidRevenue).toLocaleString("ar-SA")} subtitle="ذمم مدينة" icon={AlertCircle} color="bg-orange-500" />
            <KpiBox title="عدد الفواتير" value={String(stats.totalInvoices)} subtitle={`${stats.unpaidInvoices} غير مدفوعة`} icon={FileText} color="bg-violet-500" />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v.toLocaleString("ar-SA")} ر.ع`, "المبيعات"]} />
                    <Bar dataKey="total" fill="#0d9488" radius={[4, 4, 0, 0]} />
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
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
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
