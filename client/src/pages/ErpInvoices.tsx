import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertCircle, FileText, RefreshCw } from "lucide-react";
import { useState } from "react";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  Paid: { label: "مدفوعة", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  Unpaid: { label: "غير مدفوعة", cls: "bg-red-100 text-red-700 border-red-200" },
  Overdue: { label: "متأخرة", cls: "bg-orange-100 text-orange-700 border-orange-200" },
  Draft: { label: "مسودة", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  Cancelled: { label: "ملغاة", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  "Partly Paid": { label: "مدفوعة جزئياً", cls: "bg-amber-100 text-amber-700 border-amber-200" },
};

const FILTERS = [
  { key: "", label: "الكل" },
  { key: "Unpaid", label: "غير مدفوعة" },
  { key: "Paid", label: "مدفوعة" },
  { key: "Overdue", label: "متأخرة" },
  { key: "Draft", label: "مسودة" },
];

export default function ErpInvoices() {
  const [statusFilter, setStatusFilter] = useState("");
  const { data, isLoading, error, refetch } = trpc.erpnext.getSalesInvoices.useQuery(
    { limit: 50 },
    { staleTime: 60 * 1000 },
  );

  const invoices = ((data?.data ?? []) as Array<{
    name: string; customer: string; posting_date: string; due_date?: string;
    grand_total: number; outstanding_amount: number; status: string; currency: string;
  }>).filter(inv => !statusFilter || inv.status === statusFilter);

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              فواتير المبيعات
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">جميع فواتير المبيعات من النظام</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5 h-8 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <Button
              key={f.key}
              variant={statusFilter === f.key ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <p className="text-sm text-destructive">تعذّر جلب الفواتير: {error.message}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isLoading ? "جارٍ التحميل..." : `${invoices.length} فاتورة`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : invoices.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا توجد فواتير مطابقة</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-right p-3 font-medium">رقم الفاتورة</th>
                      <th className="text-right p-3 font-medium">العميل</th>
                      <th className="text-right p-3 font-medium">التاريخ</th>
                      <th className="text-right p-3 font-medium">الإجمالي</th>
                      <th className="text-right p-3 font-medium">المتبقي</th>
                      <th className="text-right p-3 font-medium">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => {
                      const st = STATUS_LABELS[inv.status] ?? { label: inv.status, cls: "bg-slate-100 text-slate-700" };
                      return (
                        <tr key={inv.name} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                          <td className="p-3 font-mono text-xs">{inv.name}</td>
                          <td className="p-3">{inv.customer}</td>
                          <td className="p-3 text-xs text-muted-foreground">{inv.posting_date}</td>
                          <td className="p-3 font-semibold">{(inv.grand_total ?? 0).toLocaleString("ar-SA")}</td>
                          <td className="p-3 text-xs">{(inv.outstanding_amount ?? 0).toLocaleString("ar-SA")}</td>
                          <td className="p-3"><Badge variant="outline" className={`text-[10px] ${st.cls}`}>{st.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
