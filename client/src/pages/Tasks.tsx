import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, CheckCircle2, Clock, AlertCircle, XCircle, Filter } from "lucide-react";

const taskTypeLabels: Record<string, string> = {
  bookkeeping: "مسك الدفاتر", invoice: "فاتورة", journal_entry: "قيد محاسبي",
  report: "تقرير", tax: "ضريبة", payroll: "رواتب", other: "أخرى",
};
const priorityLabels: Record<string, string> = { low: "منخفضة", medium: "متوسطة", high: "عالية", urgent: "عاجلة" };
const statusLabels: Record<string, string> = { pending: "معلق", in_progress: "جاري", completed: "مكتمل", cancelled: "ملغي" };
const statusColors: Record<string, string> = {
  pending: "badge-pending", in_progress: "badge-in_progress", completed: "badge-completed", cancelled: "badge-cancelled",
};

export default function Tasks() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const { data: tasks, isLoading } = trpc.tasks.list.useQuery(undefined, { enabled: isAuthenticated });
  const createMutation = trpc.tasks.create.useMutation({
    onSuccess: () => { toast.success("تم إنشاء المهمة بنجاح"); utils.tasks.list.invalidate(); setOpen(false); resetForm(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => { toast.success("تم تحديث الحالة"); utils.tasks.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ title: "", description: "", type: "bookkeeping" as const, priority: "medium" as const });
  const resetForm = () => setForm({ title: "", description: "", type: "bookkeeping", priority: "medium" });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => startLogin()} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  const filtered = filter === "all" ? tasks : tasks?.filter(t => t.status === filter);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="/tasks" />
      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-navy">المهام المحاسبية</h1>
            <p className="text-muted-foreground mt-1">إدارة وتتبع جميع مهامك المحاسبية</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-navy-gradient text-white hover:opacity-90"><Plus className="w-4 h-4 ml-2" />مهمة جديدة</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle className="text-navy">إنشاء مهمة جديدة</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createMutation.mutate(form); }} className="space-y-4 mt-4">
                <div>
                  <Label className="text-navy font-medium">عنوان المهمة *</Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="مثال: تسجيل قيود شهر يناير" required className="mt-1" />
                </div>
                <div>
                  <Label className="text-navy font-medium">الوصف</Label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="تفاصيل المهمة..." rows={3}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-navy/30" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-navy font-medium">نوع المهمة</Label>
                    <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as typeof form.type }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(taskTypeLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-navy font-medium">الأولوية</Label>
                    <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as typeof form.priority }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(priorityLabels).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" disabled={createMutation.isPending} className="w-full bg-navy-gradient text-white">
                  {createMutation.isPending ? "جاري الإنشاء..." : "إنشاء المهمة"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          {[["all", "الكل"], ["pending", "معلق"], ["in_progress", "جاري"], ["completed", "مكتمل"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === v ? "bg-navy text-white" : "bg-white text-muted-foreground border border-gray-200 hover:border-navy"}`}>
              {l}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered?.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-muted-foreground">لا توجد مهام في هذه الفئة</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered?.map(task => (
              <div key={task.id} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${task.status === "completed" ? "bg-green-500" : task.status === "in_progress" ? "bg-blue-500" : task.status === "cancelled" ? "bg-red-400" : "bg-yellow-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-navy">{task.title}</div>
                  {task.description && <div className="text-sm text-muted-foreground mt-0.5 truncate">{task.description}</div>}
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{taskTypeLabels[task.type]}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{priorityLabels[task.priority]}</span>
                    <span className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleDateString("ar-SA")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-3 py-1 rounded-full font-medium ${statusColors[task.status]}`}>{statusLabels[task.status]}</span>
                  {task.status === "pending" && (
                    <Button size="sm" variant="ghost" className="text-blue-600 hover:bg-blue-50"
                      onClick={() => updateMutation.mutate({ id: task.id, status: "in_progress" })}>بدء</Button>
                  )}
                  {task.status === "in_progress" && (
                    <Button size="sm" variant="ghost" className="text-green-600 hover:bg-green-50"
                      onClick={() => updateMutation.mutate({ id: task.id, status: "completed" })}>إتمام</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
