import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertCircle, FileText, Loader2, Printer, RefreshCw, Wallet, X } from "lucide-react";
import { useState } from "react";
import { useSearch } from "wouter";

type Invoice = {
  name: string; customer: string; posting_date: string; due_date?: string;
  grand_total: number; outstanding_amount: number; status: string; currency: string;
};

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
  const [loadingInvoice, setLoadingInvoice] = useState<string | null>(null);
  // قادمٌ من الضغط على عدد الفواتير في صفحة العملاء — فيفتح على فواتيره وحده
  const customerFilter = new URLSearchParams(useSearch()).get("customer") ?? "";
  const { data, isLoading, error, refetch } = trpc.erpnext.getSalesInvoices.useQuery(
    { limit: 200 },
    { staleTime: 60 * 1000 },
  );
  const pdfMutation = trpc.agent.getDocumentPdf.useMutation();

  // ─── التحصيل ─────────────────────────────────────────────────────────
  // يُفتح حواراً يعرض ما يُحصَّل قبل أن يُحصَّل — رقم الفاتورة والعميل
  // والمبلغ — ثم يسجّل سند قبض. طلبُ عميل: «يقوله إيه علشان يحصّلها».
  const [collecting, setCollecting] = useState<Invoice | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMode, setCollectMode] = useState("");
  const modesQuery = trpc.erpnext.getPaymentModes.useQuery(undefined, { staleTime: 10 * 60 * 1000 });
  const modes = modesQuery.data?.modes ?? [];
  const collectMutation = trpc.erpnext.collectInvoicePayment.useMutation({
    onSuccess: (r) => {
      toast.success(`سُجّل سند القبض ${r.name} — تحدّثت حالة الفاتورة`);
      setCollecting(null);
      void refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const openCollect = (inv: Invoice) => {
    setCollecting(inv);
    setCollectAmount(String(inv.outstanding_amount ?? inv.grand_total ?? 0));
    setCollectMode("");
  };

  const invoices = ((data?.data ?? []) as Invoice[])
    .filter(inv => !statusFilter || inv.status === statusFilter)
    .filter(inv => !customerFilter || inv.customer === customerFilter);

  // يعرض نموذج الطباعة الافتراضي الفعلي المُعدّ في نظام العميل (ERPNext/Odoo)
  // بدل إعادة بنائه في الواجهة — نفس ما يراه العميل لو طبع الفاتورة من نظامه مباشرة
  const viewInvoice = async (invoiceName: string) => {
    setLoadingInvoice(invoiceName);
    try {
      const result = await pdfMutation.mutateAsync({ doctype: "Sales Invoice", name: invoiceName });
      const byteChars = atob(result.pdfBase64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر تحميل الفاتورة");
    } finally {
      setLoadingInvoice(null);
    }
  };

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

        {customerFilter && (
          <div className="flex items-center gap-2 text-xs bg-accent/50 border rounded-lg px-3 py-2">
            <span className="text-muted-foreground">فواتير العميل:</span>
            <span className="font-medium">{customerFilter}</span>
            <a href="/erp/invoices" className="mr-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <X className="w-3 h-3" /> إلغاء التصفية
            </a>
          </div>
        )}

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
                      <th className="text-right p-3 font-medium">عرض</th>
                      <th className="text-right p-3 font-medium">تحصيل</th>
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
                          <td className="p-3">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => viewInvoice(inv.name)}
                              disabled={loadingInvoice === inv.name}
                            >
                              {loadingInvoice === inv.name
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Printer className="w-3 h-3" />}
                              الفاتورة
                            </Button>
                          </td>
                          <td className="p-3">
                            {(inv.outstanding_amount ?? 0) > 0 && inv.status !== "Draft" && inv.status !== "Cancelled" ? (
                              <Button
                                size="sm"
                                className="h-7 text-xs gap-1"
                                onClick={() => openCollect(inv)}
                              >
                                <Wallet className="w-3 h-3" />
                                تحصيل
                              </Button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Dialog open={!!collecting} onOpenChange={(o) => { if (!o) setCollecting(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                تحصيل فاتورة
              </DialogTitle>
              <DialogDescription className="text-xs">
                يُسجَّل سند قبض في نظامك مرتبطاً بهذه الفاتورة، وتتغيّر حالتها بعده.
              </DialogDescription>
            </DialogHeader>

            {collecting && (
              <div className="space-y-3">
                {/* ما يُحصَّل معروضٌ قبل التحصيل: رقم الفاتورة والعميل والمبلغ */}
                <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">رقم الفاتورة</span>
                    <span className="font-mono">{collecting.name}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">العميل</span>
                    <span className="font-medium">{collecting.customer}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">إجمالي الفاتورة</span>
                    <span>{(collecting.grand_total ?? 0).toLocaleString("ar-SA")} {collecting.currency}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">المتبقّي</span>
                    <span className="font-semibold text-amber-700">
                      {(collecting.outstanding_amount ?? 0).toLocaleString("ar-SA")} {collecting.currency}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="collect-amount" className="text-xs">المبلغ المحصَّل</Label>
                  <Input
                    id="collect-amount"
                    type="number"
                    inputMode="decimal"
                    value={collectAmount}
                    onChange={(e) => setCollectAmount(e.target.value)}
                    className="h-10 text-sm"
                  />
                  {Number(collectAmount) > (collecting.outstanding_amount ?? 0) && (
                    <p className="text-[11px] text-amber-700">المبلغ أكبر من المتبقّي — سيُسجَّل الفائض رصيداً للعميل.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">طريقة الدفع</Label>
                  {modes.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {modes.map(m => (
                        <Button
                          key={m}
                          type="button"
                          size="sm"
                          variant={collectMode === m ? "default" : "outline"}
                          className="h-8 text-xs"
                          onClick={() => setCollectMode(m)}
                        >
                          {m}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    // لا نعرض قائمة فارغة كأنها خيار: نقول إن النظام لم يُعرّف طرق دفع
                    <p className="text-[11px] text-muted-foreground">
                      لا توجد طرق دفع معرّفة في نظامك — سيُستخدم الحساب النقدي الافتراضي.
                    </p>
                  )}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" className="h-9" onClick={() => setCollecting(null)}>
                إلغاء
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                disabled={collectMutation.isPending || !(Number(collectAmount) > 0)}
                onClick={() => {
                  if (!collecting) return;
                  collectMutation.mutate({
                    invoiceName: collecting.name,
                    customer: collecting.customer,
                    amount: Number(collectAmount),
                    ...(collectMode ? { mode: collectMode } : {}),
                  });
                }}
              >
                {collectMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Wallet className="w-3.5 h-3.5" />}
                تأكيد التحصيل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
