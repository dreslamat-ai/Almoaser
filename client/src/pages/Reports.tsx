import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileText, CheckCircle2, XCircle, Clock, ArrowRight, Loader2 } from "lucide-react";

const KIND_LABELS: Record<string, string> = {
  system_assessment: "تقييم نظام",
  handover_terms: "بنود استلام وتسليم",
  contract_review: "مراجعة تنفيذ عقد",
  policies: "سياسات وإجراءات",
  workflow_design: "تصميم دورة عمل",
  other: "تقرير",
};

const STATUS: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  pending_review: { label: "بانتظار مراجعتك", cls: "text-amber-800 bg-amber-50 border-amber-200", Icon: Clock },
  approved: { label: "مُقَر", cls: "text-emerald-800 bg-emerald-50 border-emerald-200", Icon: CheckCircle2 },
  rejected: { label: "مرفوض", cls: "text-red-700 bg-red-50 border-red-200", Icon: XCircle },
  draft: { label: "مسوّدة", cls: "text-gray-700 bg-gray-50 border-gray-200", Icon: FileText },
};

export default function Reports() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [openId, setOpenId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const { data: reports } = trpc.reports.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: report } = trpc.reports.get.useQuery({ id: openId ?? 0 }, { enabled: openId != null });
  const reviewMutation = trpc.reports.review.useMutation({
    onSuccess: (_r, vars) => {
      toast.success(vars.approve ? "تم إقرار التقرير" : "تم تسجيل رفضك للتقرير");
      setNote("");
      utils.reports.list.invalidate();
      utils.reports.get.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-navy" /></div>;
  if (!isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center">
      <Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button>
    </div>;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/reports" />
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-navy">التقارير</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            تقارير التقييم والاستلام والسياسات المُعدّة لحسابك — محفوظة دائماً ويمكن الرجوع إليها في أي وقت.
          </p>
        </div>

        {openId == null && (
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {(reports ?? []).map(r => {
              const st = STATUS[r.status] ?? STATUS.draft;
              return (
                <button key={r.id} onClick={() => setOpenId(r.id)}
                  className="w-full text-right flex items-center gap-3 p-4 border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <FileText className="w-5 h-5 text-navy shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{r.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {KIND_LABELS[r.kind] ?? "تقرير"} · {new Date(r.createdAt).toLocaleDateString("ar-SA")}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full border shrink-0 ${st.cls}`}>{st.label}</span>
                </button>
              );
            })}
            {reports && reports.length === 0 && (
              <p className="p-10 text-center text-muted-foreground text-sm">
                لا توجد تقارير بعد. اطلب من المحاسب الذكي تقييم نظامك وسيُحفظ التقرير هنا.
              </p>
            )}
          </div>
        )}

        {openId != null && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-bold text-navy truncate">{report?.title ?? "..."}</h2>
                {report && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {KIND_LABELS[report.kind] ?? "تقرير"} · {new Date(report.createdAt).toLocaleString("ar-SA")}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" className="gap-1 shrink-0 text-xs" onClick={() => setOpenId(null)}>
                <ArrowRight className="w-3.5 h-3.5" /> رجوع
              </Button>
            </div>

            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-7 text-foreground border-t border-gray-100 pt-4">
              {report?.content}
            </div>

            {report?.status === "pending_review" && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="text-sm font-medium text-navy mb-2">مراجعتك</p>
                <p className="text-xs text-muted-foreground mb-2">
                  التقرير مسوّدة حتى تقرّه. راجع ما ورد فيه، وسجّل ملاحظتك إن وُجدت.
                </p>
                <Textarea value={note} onChange={e => setNote(e.target.value.slice(0, 2000))}
                  placeholder="ملاحظة (اختياري)" className="text-sm mb-3" rows={3} />
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ id: report.id, approve: true, note: note.trim() || undefined })}>
                    <CheckCircle2 className="w-4 h-4" /> إقرار التقرير
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50 gap-1"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ id: report.id, approve: false, note: note.trim() || undefined })}>
                    <XCircle className="w-4 h-4" /> رفض / إعادة
                  </Button>
                </div>
              </div>
            )}

            {report && report.status !== "pending_review" && report.reviewedAt && (
              <div className="mt-6 border-t border-gray-100 pt-4 text-sm">
                <span className={`text-xs px-2 py-1 rounded-full border ${(STATUS[report.status] ?? STATUS.draft).cls}`}>
                  {(STATUS[report.status] ?? STATUS.draft).label}
                </span>
                <span className="text-xs text-muted-foreground mr-2">
                  {new Date(report.reviewedAt).toLocaleString("ar-SA")}
                </span>
                {report.reviewNote && <p className="text-muted-foreground mt-2 whitespace-pre-wrap">{report.reviewNote}</p>}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
