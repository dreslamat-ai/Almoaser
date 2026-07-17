import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Zap, Bot, BookOpen, Crown } from "lucide-react";

export default function Subscription() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const { data: subscription } = trpc.subscription.get.useQuery(undefined, { enabled: isAuthenticated });
  const { data: plans } = trpc.plans.list.useQuery();
  const createMutation = trpc.subscription.create.useMutation({
    onSuccess: () => { toast.success("تم تفعيل الاشتراك بنجاح!"); utils.subscription.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const upgradeMutation = trpc.subscription.upgrade.useMutation({
    onSuccess: () => { toast.success("تم ترقية الاشتراك بنجاح!"); utils.subscription.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  const planIcons = [<BookOpen className="w-6 h-6" />, <Zap className="w-6 h-6" />, <Bot className="w-6 h-6" />];
  const currentPlan = plans?.find(p => p.id === subscription?.planId);

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/subscription" />
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">إدارة الاشتراك</h1>
          <p className="text-muted-foreground mt-1">اختر الباقة المناسبة لعملك</p>
        </div>

        {subscription && (
          <div className="bg-navy-gradient rounded-2xl p-6 text-white mb-8">
            <div className="flex items-center gap-4">
              <Crown className="w-10 h-10 text-gold" />
              <div>
                <div className="font-bold text-xl">{currentPlan?.nameAr ?? "باقة نشطة"}</div>
                <div className="text-white/70 text-sm">
                  الحالة: {subscription.status === "active" ? "✅ نشط" : "🔄 تجريبي"} •
                  {currentPlan ? ` ${Number(currentPlan.price).toLocaleString("ar-SA")} ريال/شهر` : ""}
                </div>
              </div>
            </div>
          </div>
        )}

        <h2 className="text-lg font-bold text-navy mb-4">{subscription ? "ترقية الباقة" : "اختر باقتك"}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {plans?.map((plan, i) => {
            const features: string[] = plan.features ? JSON.parse(plan.features) : [];
            const isCurrent = subscription?.planId === plan.id;
            const isPopular = i === 1;
            return (
              <div key={plan.id} className={`rounded-2xl border-2 bg-white p-6 relative ${isCurrent ? "border-gold" : isPopular ? "border-navy" : "border-gray-200"}`}>
                {isCurrent && <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-gold text-white text-xs font-bold px-3 py-1 rounded-full">باقتك الحالية</div>}
                {isPopular && !isCurrent && <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-navy text-white text-xs font-bold px-3 py-1 rounded-full">الأكثر طلباً</div>}
                <div className={`w-12 h-12 rounded-xl mb-4 flex items-center justify-center ${isPopular ? "bg-navy-gradient text-white" : "bg-gray-100 text-navy"}`}>{planIcons[i]}</div>
                <h3 className="text-xl font-bold text-navy mb-1">{plan.nameAr}</h3>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className="text-3xl font-bold text-navy">{Number(plan.price).toLocaleString("ar-SA")}</span>
                  <span className="text-muted-foreground text-sm">ريال / شهر</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <Button disabled className="w-full" variant="outline">باقتك الحالية</Button>
                ) : subscription ? (
                  <Button onClick={() => upgradeMutation.mutate({ planId: plan.id })} disabled={upgradeMutation.isPending}
                    className={`w-full ${isPopular ? "bg-navy-gradient text-white" : "border-navy text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}>
                    {upgradeMutation.isPending ? "جاري الترقية..." : "ترقية إلى هذه الباقة"}
                  </Button>
                ) : (
                  <Button onClick={() => createMutation.mutate({ planId: plan.id })} disabled={createMutation.isPending}
                    className={`w-full ${isPopular ? "bg-navy-gradient text-white" : "border-navy text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}>
                    {createMutation.isPending ? "جاري التفعيل..." : "اشترك الآن"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
