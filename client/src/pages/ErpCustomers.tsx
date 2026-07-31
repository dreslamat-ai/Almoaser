import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { AlertCircle, RefreshCw, Search, Users } from "lucide-react";
import { useState } from "react";

export default function ErpCustomers() {
  const [search, setSearch] = useState("");
  const { data, isLoading, error, refetch } = trpc.erpnext.getCustomers.useQuery(
    { limit: 100 },
    { staleTime: 60 * 1000 },
  );

  const customers = ((data?.data ?? []) as Array<{
    name: string; customer_name: string; customer_type: string; mobile_no?: string; email_id?: string;
  }>).filter(c => !search || c.customer_name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <DashboardLayout>
      <div className="space-y-5 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              العملاء
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">جميع العملاء المسجلين في النظام</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetch()} className="gap-1.5 h-8 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            aria-label="ابحث باسم العميل" placeholder="ابحث باسم العميل..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pr-9 h-9 text-sm"
          />
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <p className="text-sm text-destructive">تعذّر جلب العملاء: {error.message}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {isLoading ? "جارٍ التحميل..." : `${customers.length} عميل`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : customers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">لا يوجد عملاء مطابقون</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-right p-3 font-medium">اسم العميل</th>
                      <th className="text-right p-3 font-medium">النوع</th>
                      <th className="text-right p-3 font-medium">الجوال</th>
                      <th className="text-right p-3 font-medium">البريد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map(c => (
                      <tr key={c.name} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                        <td className="p-3 font-medium">{c.customer_name}</td>
                        <td className="p-3 text-xs text-muted-foreground">{c.customer_type === "Company" ? "شركة" : "فرد"}</td>
                        <td className="p-3 text-xs" dir="ltr">{c.mobile_no || "—"}</td>
                        <td className="p-3 text-xs" dir="ltr">{c.email_id || "—"}</td>
                      </tr>
                    ))}
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
