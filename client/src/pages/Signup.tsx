import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, UserPlus, Eye, EyeOff, Globe, ArrowLeft, ArrowRight,
  CheckCircle2, Sparkles, Gift,
} from "lucide-react";
import { planCapacityDetail } from "@shared/planDisplay";

export default function Signup() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<1 | 2>(1);
  const [provider, setProvider] = useState<"erpnext" | "odoo">("erpnext");
  const [erpUrl, setErpUrl] = useState("");
  const [database, setDatabase] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  // الباقة تصل من بطاقة الأسعار عبر ?plan= فلا نسأل عنها مرة ثانية
  const [planId, setPlanId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("plan");
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  const [showAllPlans, setShowAllPlans] = useState(false);
  const utils = trpc.useUtils();

  const plansQuery = trpc.plans.list.useQuery();

  const signupMutation = trpc.auth.signupWithErp.useMutation({
    onSuccess: async (data) => {
      toast.success(`مرحباً ${data.name}! بدأت فترتك التجريبية المجانية (3 أيام)`);
      await utils.auth.me.invalidate();
      navigate("/erp");
    },
    onError: (err) => {
      toast.error(err.message || "تعذّر إنشاء الحساب");
    },
  });

  // نتحقق من بيانات ERPNext فوراً هنا بدل الانتظار لنهاية الخطوة الثانية —
  // لو غلط، المستخدم يعرف فوراً بدل ما يختار باقة ويكتشف الخطأ بعدها
  const testCredsMutation = trpc.auth.testErpCredentials.useMutation();

  const goToStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!erpUrl.trim() || !/^https?:\/\/.+/.test(erpUrl.trim())) {
      toast.error("أدخل رابط نظامك بشكل صحيح — يجب أن يبدأ بـ https://");
      return;
    }
    if (provider === "odoo" && !database.trim()) {
      toast.error("أدخل اسم قاعدة بيانات Odoo");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      toast.error("أدخل بريدك الإلكتروني في النظام");
      return;
    }
    if (!password) {
      toast.error("أدخل كلمة المرور");
      return;
    }
    // الرقم يُتحقَّق منه هنا لا في الخطوة الثانية: حقله في هذه الخطوة، ومنعُ
    // التقدّم بلا رسالة يترك المستخدم أمام زر ميت لا يرى سببه.
    if (!phone.trim()) {
      toast.error("أدخل رقم جوالك");
      return;
    }
    const result = await testCredsMutation.mutateAsync({
      erpUrl: erpUrl.trim(), email: email.trim(), password,
      provider, database: provider === "odoo" ? database.trim() : undefined,
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`تم التحقق من حسابك — مرحباً ${result.fullName}`);
    setStep(2);
  };

  // رابط بباقة غير موجودة يجب ألا يترك القائمة فارغة والمستخدم عالقاً
  const allPlans = plansQuery.data ?? [];
  const chosenExists = planId != null && allPlans.some(p => p.id === planId);
  const visiblePlans = showAllPlans || !chosenExists ? allPlans : allPlans.filter(p => p.id === planId);

  const submit = () => {
    if (!planId) {
      toast.error("اختر الباقة المناسبة لك");
      return;
    }
    if (!phone.trim()) {
      toast.error("أدخل رقم جوالك");
      return;
    }
    signupMutation.mutate({
      erpUrl: erpUrl.trim(),
      email: email.trim(),
      password,
      planId,
      companyName: companyName.trim() || undefined,
      phone: phone.trim(),
      provider,
      database: provider === "odoo" ? database.trim() : undefined,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 p-4" dir="rtl">
      <Card className="w-full max-w-lg p-8 shadow-lg border-border/60">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img
            src="/manus-storage/almoaser-icon-192_bc4dbf5e.png"
            alt="المعاصر AI"
            className="w-14 h-14 rounded-2xl object-contain bg-white border border-border shadow-sm"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">إنشاء حساب جديد</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {step === 1 ? "اربط حسابك في نظام ERP الخاص بك" : "اختر الباقة المناسبة"}
            </p>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-8 h-1.5 rounded-full transition-colors ${step >= 1 ? "bg-primary" : "bg-muted"}`} />
            <div className={`w-8 h-1.5 rounded-full transition-colors ${step >= 2 ? "bg-primary" : "bg-muted"}`} />
          </div>
        </div>

        {step === 1 && (
          <form onSubmit={goToStep2} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="erp-provider">نوع نظام ERP</Label>
              <Select value={provider} onValueChange={v => setProvider(v as "erpnext" | "odoo")}>
                <SelectTrigger id="erp-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="erpnext">ERPNext</SelectItem>
                  <SelectItem value="odoo">Odoo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="erpUrl">رابط نظامك ({provider === "odoo" ? "Odoo" : "ERPNext"})</Label>
              <div className="relative">
                <Input
                  id="erpUrl" type="url" dir="ltr"
                  placeholder={provider === "odoo" ? "https://your-company.odoo.com" : "https://your-company.erpnext.com"}
                  value={erpUrl} onChange={e => setErpUrl(e.target.value)}
                  className="text-left pr-9"
                />
                <Globe className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
            {provider === "odoo" && (
              <div className="space-y-1.5">
                <Label htmlFor="s-database">اسم قاعدة بيانات Odoo</Label>
                <Input
                  id="s-database" dir="ltr"
                  placeholder="my_company_db"
                  value={database} onChange={e => setDatabase(e.target.value)}
                  className="text-left font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="s-email">البريد الإلكتروني (حسابك في النظام)</Label>
              <Input
                id="s-email" type="email" dir="ltr" autoComplete="username"
                placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)}
                className="text-left"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-password">كلمة المرور (نفس كلمة مرور النظام)</Label>
              <div className="relative">
                <Input
                  id="s-password" type={showPassword ? "text" : "password"} dir="ltr"
                  autoComplete="current-password" placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="text-left pl-10"
                />
                <button type="button" onClick={() => setShowPassword(s => !s)} tabIndex={-1}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={showPassword}
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-company">اسم الشركة (اختياري)</Label>
                <Input id="s-company" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="شركتك" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-phone">رقم الجوال</Label>
                <Input id="s-phone" dir="ltr" inputMode="tel" autoComplete="tel" value={phone}
                  onChange={e => setPhone(e.target.value)} placeholder="05xxxxxxxx" className="text-left" />
                <p className="text-[11px] text-muted-foreground mt-1">سنطلب تأكيده لاحقاً لتأمين حسابك</p>
              </div>
            </div>
            <Button type="submit" className="w-full h-11 gap-2" disabled={testCredsMutation.isPending}>
              {testCredsMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق من حسابك...</>
                : <>التالي: اختيار الباقة <ArrowLeft className="w-4 h-4" /></>}
            </Button>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Trial banner */}
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <Gift className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-800">
                <span className="font-bold">فترة تجريبية مجانية 3 أيام</span> على أي باقة — تبدأ فوراً، ولا يُطلب دفع الآن.
              </p>
            </div>

            {plansQuery.isLoading && (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" /> جارٍ تحميل الباقات...
              </div>
            )}

            <div className="space-y-2">
              {visiblePlans.map(plan => (
                <button key={plan.id} type="button" onClick={() => setPlanId(plan.id)}
                  className={`w-full flex items-center gap-3 rounded-xl border p-4 text-right transition-all ${
                    planId === plan.id
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-border hover:border-primary/40 hover:bg-muted/30"
                  }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    planId === plan.id ? "border-primary bg-primary" : "border-muted-foreground/40"
                  }`}>
                    {planId === plan.id && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-foreground">{plan.nameAr}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {planCapacityDetail(plan)}
                    </p>
                  </div>
                  <div className="text-left shrink-0">
                    <p className="font-bold text-primary text-lg">{Number(plan.price).toLocaleString()} <span className="text-xs">{plan.currency}</span></p>
                    <p className="text-xs text-muted-foreground">{plan.billingCycle === "monthly" ? "شهرياً" : "سنوياً"}</p>
                  </div>
                </button>
              ))}
            </div>

            {!showAllPlans && chosenExists && allPlans.length > 1 && (
              <button type="button" onClick={() => setShowAllPlans(true)}
                className="w-full text-xs text-primary hover:underline [@media(pointer:coarse)]:min-h-11">
                عرض باقي الباقات
              </button>
            )}

            <p className="text-[11px] text-muted-foreground text-center">الأسعار لا تشمل ضريبة القيمة المضافة (15%) · خصم 15% عند الدفع السنوي</p>

            <div className="flex gap-2">
              <Button variant="outline" className="h-11 gap-2" onClick={() => setStep(1)} disabled={signupMutation.isPending}>
                <ArrowRight className="w-4 h-4" /> رجوع
              </Button>
              <Button className="flex-1 h-11 gap-2" onClick={submit} disabled={signupMutation.isPending || !planId}>
                {signupMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق من نظامك وإنشاء الحساب...</>
                  : <><Sparkles className="w-4 h-4" /> ابدأ التجربة المجانية</>}
              </Button>
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground text-center mt-6">
          لديك حساب بالفعل؟{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">سجّل الدخول</Link>
        </p>
      </Card>
    </div>
  );
}
