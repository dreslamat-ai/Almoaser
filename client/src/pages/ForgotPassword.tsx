import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Mail, KeyRound, ArrowRight, Eye, EyeOff, Database } from "lucide-react";

type Step =
  | { name: "email" }
  | { name: "code"; challengeId: string; maskedEmail: string }
  | { name: "done" };

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [step, setStep] = useState<Step>({ name: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const requestOtp = trpc.auth.requestLoginOtp.useMutation();
  const verifyOtp = trpc.auth.verifyLoginOtp.useMutation();
  const setPassword = trpc.auth.setLocalPassword.useMutation();

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast.error("أدخل بريدك الإلكتروني"); return; }
    setIsPending(true);
    try {
      const res = await requestOtp.mutateAsync({ email: email.trim() });
      setStep({ name: "code", challengeId: res.challengeId, maskedEmail: res.maskedEmail });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إرسال الرمز");
    } finally {
      setIsPending(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step.name !== "code" || code.trim().length < 4) { toast.error("أدخل الرمز المرسل إلى بريدك"); return; }
    setIsPending(true);
    try {
      const data = await verifyOtp.mutateAsync({ challengeId: step.challengeId, code: code.trim() });
      await utils.auth.me.invalidate();
      toast.success(`مرحباً ${data.name ?? ""}! تم تسجيل دخولك`);
      setStep({ name: "done" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "رمز غير صحيح");
    } finally {
      setIsPending(false);
    }
  };

  const submitNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { toast.error("كلمة المرور 8 أحرف على الأقل"); return; }
    setIsPending(true);
    try {
      await setPassword.mutateAsync({ password: newPassword });
      toast.success("تم تعيين كلمة المرور الجديدة");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تعيين كلمة المرور");
    } finally {
      setIsPending(false);
    }
  };

  const isMember = user?.orgRole === "member";

  return (
    <div className="auth-shell" dir="rtl">
      <div className="auth-card max-w-md">
        <div className="flex flex-col items-center gap-3 mb-7">
          <img
            src="/manus-storage/almoaser-icon-192_bc4dbf5e.png"
            alt="المعاصر AI"
            className="auth-logo"
          />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-navy tracking-tight">استعادة الدخول</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {step.name === "email" && "نسيت كلمة المرور؟ ادخل برمز يُرسل إلى بريدك"}
              {step.name === "code" && "أدخل الرمز الذي وصلك"}
              {step.name === "done" && "تم تسجيل دخولك"}
            </p>
          </div>
        </div>

        {/* ① البريد */}
        {step.name === "email" && (
          <form onSubmit={submitEmail} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fp-email">البريد الإلكتروني المسجَّل</Label>
              <Input
                id="fp-email" type="email" dir="ltr" autoComplete="username" autoFocus
                placeholder="you@example.com" value={email}
                onChange={e => setEmail(e.target.value)} disabled={isPending} className="text-left"
              />
            </div>
            <Button type="submit" className="w-full h-12 gap-2 font-semibold" disabled={isPending}>
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الإرسال...</>
                : <><Mail className="w-4 h-4" /> أرسل لي رمز الدخول</>}
            </Button>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              إن كان البريد مسجّلاً لدينا فسيصلك رمز من 6 أرقام صالح لعشر دقائق.
            </p>
          </form>
        )}

        {/* ② الرمز */}
        {step.name === "code" && (
          <form onSubmit={submitCode} className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
              <ShieldCheck className="w-6 h-6 mx-auto text-primary mb-1.5" />
              <p className="text-sm text-foreground font-medium">تحقّق من بريدك</p>
              <p className="text-xs text-muted-foreground mt-1">
                أرسلنا رمزاً من 6 أرقام إلى <span dir="ltr" className="font-mono">{step.maskedEmail}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-code">رمز الدخول</Label>
              <Input
                id="fp-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                placeholder="000000" maxLength={6} autoFocus
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={isPending}
                className="text-center text-2xl tracking-[0.5em] font-mono h-14"
              />
            </div>
            <Button type="submit" className="w-full h-12 gap-2 font-semibold" disabled={isPending || code.length < 4}>
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق...</>
                : <><KeyRound className="w-4 h-4" /> دخول</>}
            </Button>
            <button
              type="button"
              onClick={() => { setStep({ name: "email" }); setCode(""); }}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              لم يصلك الرمز؟ جرّب بريداً آخر
            </button>
          </form>
        )}

        {/* ③ بعد الدخول */}
        {step.name === "done" && (
          isMember ? (
            <form onSubmit={submitNewPassword} className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                عيّن كلمة مرور جديدة لحسابك، أو تخطَّ هذه الخطوة وادخل مباشرة.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="fp-newpass">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <Input
                    id="fp-newpass" type={showPassword ? "text" : "password"} dir="ltr"
                    autoComplete="new-password" placeholder="8 أحرف على الأقل" value={newPassword}
                    onChange={e => setNewPassword(e.target.value)} disabled={isPending}
                    className="text-left pl-10"
                  />
                  <button
                    type="button" tabIndex={-1} onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={showPassword}
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full h-12 gap-2 font-semibold" disabled={isPending || newPassword.length < 8}>
                {isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ الحفظ...</>
                  : <><KeyRound className="w-4 h-4" /> احفظ كلمة المرور</>}
              </Button>
              <button
                type="button" onClick={() => navigate("/dashboard")}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                تخطّي والذهاب للوحة التحكم
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {/* مالك الحساب: كلمة مروره في نظامه هو، ولا نستطيع تغييرها من هنا */}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm leading-relaxed">
                <div className="flex items-start gap-2">
                  <Database className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-amber-900">
                    <p className="font-medium mb-1">كلمة مرورك ليست عندنا</p>
                    <p className="text-[13px]">
                      حسابك يسجّل الدخول ببيانات نظام ERPNext أو Odoo الخاص بك، فتغييرها يتم من هناك.
                      إن كنت قد غيّرتها بالفعل، حدّث كلمة المرور المحفوظة في إعدادات الربط حتى يستمر
                      المحاسب الذكي في العمل.
                    </p>
                  </div>
                </div>
              </div>
              <Button onClick={() => navigate("/channels")} variant="outline" className="w-full h-12 gap-2 font-semibold">
                <Database className="w-4 h-4" /> تحديث بيانات ربط ERP
              </Button>
              <Button onClick={() => navigate("/dashboard")} className="w-full h-12 gap-2 font-semibold">
                <ArrowRight className="w-4 h-4" /> الذهاب للوحة التحكم
              </Button>
            </div>
          )
        )}

        {step.name !== "done" && (
          <>
            <p className="text-sm text-muted-foreground text-center mt-6 pt-5 border-t border-navy/10">
              تذكّرت كلمة المرور؟{" "}
              <Link href="/login" className="text-navy font-semibold hover:text-gold-ink transition-colors">تسجيل الدخول</Link>
            </p>
            <p className="text-center mt-3">
              <Link href="/" className="inline-flex items-center min-h-11 text-sm text-muted-foreground hover:text-navy transition-colors">
                العودة إلى الصفحة الرئيسية
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
