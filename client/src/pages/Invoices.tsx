import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";

const statusLabels: Record<string, string> = { pending: "معلقة", paid: "مدفوعة", overdue: "متأخرة", cancelled: "ملغية" };
const statusColors: Record<string, string> = { pending: "badge-pending", paid: "badge-completed", overdue: "badge-cancelled", cancelled: "badge-cancelled" };

export default function Invoices() {
  const { isAuthenticated, loading } = useAuth();
  const { data: invoices, isLoading } = trpc.invoices.list.useQuery(undefined, { enabled: isAuthenticated });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">فواتير الخدمة</h1>
          <p className="text-muted-foreground mt-1">سجل فواتير اشتراكك الشهري</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>
        ) : invoices?.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-muted-foreground">لا توجد فواتير بعد</p>
            <p className="text-sm text-muted-foreground mt-1">ستظهر فواتير اشتراكك هنا بعد التفعيل</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {["رقم الفاتورة", "المبلغ", "تاريخ الإصدار", "تاريخ الاستحقاق", "الحالة", ""].map(h => (
                    <th key={h} className="px-5 py-3 text-right text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices?.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4 font-mono text-sm text-navy">{inv.invoiceNumber}</td>
                    <td className="px-5 py-4 font-bold text-navy">{Number(inv.amount).toLocaleString("ar-SA")} {inv.currency}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString("ar-SA")}</td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("ar-SA") : "—"}</td>
                    <td className="px-5 py-4"><span className={`text-xs px-3 py-1 rounded-full font-medium ${statusColors[inv.status]}`}>{statusLabels[inv.status]}</span></td>
                    <td className="px-5 py-4"><Button variant="ghost" size="sm" className="text-navy"><Download className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
