import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { BookOpen, FileText, DollarSign, BarChart3, Settings, LogOut, CheckCircle2, Clock, AlertCircle, TrendingUp, Bot, MessageCircle, Database } from "lucide-react";

function Sidebar({ active }: { active: string }) {
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const navItems = [
    { path: "/dashboard", label: "الرئيسية", icon: <BarChart3 className="w-5 h-5" /> },
    { path: "/tasks", label: "المهام", icon: <CheckCircle2 className="w-5 h-5" /> },
    { path: "/invoices", label: "الفواتير", icon: <FileText className="w-5 h-5" /> },
    { path: "/subscription", label: "الاشتراك", icon: <DollarSign className="w-5 h-5" /> },
    { path: "/erp", label: "نظام ERP", icon: <Database className="w-5 h-5" /> },
  ];
  return (
    <aside className="w-64 bg-navy-hero min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center overflow-hidden">
            <img
              src="/manus-storage/almoaser-icon-192_bc4dbf5e.png"
              alt="شعار المعاصر"
              className="w-8 h-8 object-contain"
            />
          </div>
          <div>
            <div className="font-bold text-white">Almoaser <span className="text-gold text-xs font-light">AI ERP</span></div>
            <div className="text-xs text-white/50">لوحة التحكم</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${active === item.path ? "bg-white/15 text-white font-medium" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-white/10 space-y-1">
        <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-white/60 hover:bg-white/10 hover:text-white transition-all">
          <Settings className="w-5 h-5" />
          الإعدادات
        </button>
        <button onClick={() => logout()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all">
          <LogOut className="w-5 h-5" />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}

export { Sidebar };

export default function Dashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const { data: tasks } = trpc.tasks.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: invoices } = trpc.invoices.list.useQuery(undefined, { enabled: isAuthenticated });
  const { data: subscription } = trpc.subscription.get.useQuery(undefined, { enabled: isAuthenticated });
  const { data: plans } = trpc.plans.list.useQuery();

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Bot className="w-16 h-16 text-navy mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-navy mb-2">مرحباً بك في Almoaser AI ERP</h2>
          <p className="text-muted-foreground mb-6">سجّل دخولك للوصول إلى لوحة التحكم</p>
          <Button onClick={() => startLogin()} className="bg-navy-gradient text-white hover:opacity-90">تسجيل الدخول</Button>
        </div>
      </div>
    );
  }

  const pendingTasks = tasks?.filter(t => t.status === "pending").length ?? 0;
  const completedTasks = tasks?.filter(t => t.status === "completed").length ?? 0;
  const totalInvoices = invoices?.length ?? 0;
  const currentPlan = plans?.find(p => p.id === subscription?.planId);

  const stats = [
    { label: "المهام المعلقة", value: pendingTasks, icon: <Clock className="w-6 h-6" />, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "المهام المكتملة", value: completedTasks, icon: <CheckCircle2 className="w-6 h-6" />, color: "text-green-600", bg: "bg-green-50" },
    { label: "إجمالي الفواتير", value: totalInvoices, icon: <FileText className="w-6 h-6" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "حالة الاشتراك", value: subscription?.status === "active" ? "نشط" : subscription?.status === "trial" ? "تجريبي" : "غير نشط", icon: <TrendingUp className="w-6 h-6" />, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="/dashboard" />
      <main className="flex-1 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">مرحباً، {user?.name ?? "عزيزي العميل"} 👋</h1>
          <p className="text-muted-foreground mt-1">هذا ملخص حسابك في Almoaser AI ERP</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
              <div className={`w-12 h-12 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-3`}>{s.icon}</div>
              <div className="text-2xl font-bold text-navy">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-navy">آخر المهام</h2>
              <Button variant="ghost" size="sm" onClick={() => navigate("/tasks")} className="text-navy">عرض الكل</Button>
            </div>
            {tasks?.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">لا توجد مهام بعد</p>
                <Button size="sm" onClick={() => navigate("/tasks")} className="mt-3 bg-navy-gradient text-white">أضف مهمة</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {tasks?.slice(0, 4).map(task => (
                  <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${task.status === "completed" ? "bg-green-500" : task.status === "in_progress" ? "bg-blue-500" : "bg-yellow-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-navy truncate">{task.title}</div>
                      <div className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleDateString("ar-SA")}</div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${task.status === "completed" ? "badge-completed" : task.status === "in_progress" ? "badge-in_progress" : "badge-pending"}`}>
                      {task.status === "completed" ? "مكتمل" : task.status === "in_progress" ? "جاري" : "معلق"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="font-bold text-navy mb-4">تفاصيل الاشتراك</h2>
            {subscription ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-navy/5 border border-navy/10">
                  <div className="font-bold text-navy text-lg">{currentPlan?.nameAr ?? "غير محدد"}</div>
                  <div className="text-sm text-muted-foreground">{currentPlan ? `${Number(currentPlan.price).toLocaleString("ar-SA")} ريال / شهر` : ""}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">الحالة: </span><span className={`font-medium ${subscription.status === "active" ? "text-green-600" : "text-yellow-600"}`}>{subscription.status === "active" ? "نشط" : "تجريبي"}</span></div>
                  <div><span className="text-muted-foreground">الشركة: </span><span className="font-medium text-navy">{subscription.companyName ?? "—"}</span></div>
                </div>
                <Button onClick={() => navigate("/subscription")} variant="outline" className="w-full border-navy text-navy hover:bg-navy hover:text-white">إدارة الاشتراك</Button>
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertCircle className="w-10 h-10 mx-auto mb-2 text-yellow-500" />
                <p className="text-sm text-muted-foreground mb-3">لم تشترك في أي باقة بعد</p>
                <Button onClick={() => navigate("/subscription")} className="bg-navy-gradient text-white">اختر باقة</Button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 bg-navy-gradient rounded-2xl p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-6 h-6 text-gold" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-lg">وكيل AI جاهز لمساعدتك</h3>
              <p className="text-white/70 text-sm">أرسل أوامرك عبر واتساب وسينفذها الوكيل فوراً في Almoaser AI ERP</p>
            </div>
            <a href="https://wa.me/966564677377?text=مرحباً، أريد التواصل مع وكيل Almoaser AI ERP" target="_blank" rel="noopener noreferrer">
              <Button className="bg-gold text-white hover:bg-gold/90 flex-shrink-0">تواصل عبر واتساب</Button>
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
