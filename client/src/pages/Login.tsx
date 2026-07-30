import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, LogIn, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const utils = trpc.useUtils();

  // خطوة رمز التحقق (OTP) — تظهر بعد نجاح بيانات الدخول إن طلبها السيرفر
  const [otp, setOtp] = useState<{ challengeId: string; maskedEmail: string } | null>(null);
  const [code, setCode] = useState("");

  const loginMemberMutation = trpc.auth.loginMember.useMutation();
  const loginErpMutation = trpc.auth.loginWithErp.useMutation();
  const verifyOtpMutation = trpc.auth.verifyLoginOtp.useMutation();

  const finish = async (name?: string | null) => {
    toast.success(`مرحباً ${name ?? ""}! تم تسجيل الدخول بنجاح`);
    await utils.auth.me.invalidate();
    navigate("/erp");
  };

  // نجرّب أولاً دخول المستخدم الفرعي (باسورد محلي) — أسرع وأخف على ERPNext.
  // لو الحساب مش مستخدماً فرعياً، نجرّب دخول ERPNext المعتاد (لمالكي الحسابات).
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }
    setIsPending(true);
    try {
      let data: Awaited<ReturnType<typeof loginMemberMutation.mutateAsync>>;
      try {
        data = await loginMemberMutation.mutateAsync({ email: email.trim(), password });
      } catch {
        data = await loginErpMutation.mutateAsync({ email: email.trim(), password });
      }
      if ("otpRequired" in data && data.otpRequired) {
        setOtp({ challengeId: data.challengeId, maskedEmail: data.maskedEmail });
        toast.success(`أرسلنا رمز التحقق إلى ${data.maskedEmail}`);
        return;
      }
      await finish(data.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setIsPending(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || code.trim().length < 4) {
      toast.error("أدخل رمز التحقق المرسل إلى بريدك");
      return;
    }
    setIsPending(true);
    try {
      const data = await verifyOtpMutation.mutateAsync({ challengeId: otp.challengeId, code: code.trim() });
      await finish(data.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "رمز غير صحيح");
    } finally {
      setIsPending(false);
    }
  };

  const restart = () => { setOtp(null); setCode(""); setPassword(""); };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 p-4" dir="rtl">
      <Card className="w-full max-w-md p-8 shadow-lg border-border/60">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img
            src="/manus-storage/almoaser-icon-192_bc4dbf5e.png"
            alt="المعاصر AI"
            className="w-16 h-16 rounded-2xl object-contain bg-white border border-border shadow-sm"
          />
          <div className="text-center">
            <h1 className="text-xl font-bold text-foreground">Almoaser AI ERP</h1>
            <p className="text-sm text-muted-foreground mt-1">سجّل الدخول بحسابك في نظام ERP</p>
          </div>
        </div>

        {otp ? (
          <form onSubmit={submitOtp} className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
              <ShieldCheck className="w-6 h-6 mx-auto text-primary mb-1.5" />
              <p className="text-sm text-foreground font-medium">تحقّق من بريدك</p>
              <p className="text-xs text-muted-foreground mt-1">
                أرسلنا رمزاً من 6 أرقام إلى <span dir="ltr" className="font-mono">{otp.maskedEmail}</span>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="otp-code">رمز التحقق</Label>
              <Input
                id="otp-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code"
                placeholder="000000" maxLength={6} autoFocus
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={isPending}
                className="text-center text-2xl tracking-[0.5em] font-mono h-14"
              />
            </div>
            <Button type="submit" className="w-full h-11 gap-2" disabled={isPending || code.length < 4}>
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق...</>
                : <><ShieldCheck className="w-4 h-4" /> تأكيد الدخول</>}
            </Button>
            <button type="button" onClick={restart} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
              الرجوع وإعادة تسجيل الدخول
            </button>
          </form>
        ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={isPending}
              className="text-left"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">كلمة المرور</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isPending}
                className="text-left pl-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full h-11 gap-2" disabled={isPending}>
            {isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق من حسابك...</>
              : <><LogIn className="w-4 h-4" /> تسجيل الدخول</>}
          </Button>
        </form>
        )}

        <p className="text-sm text-muted-foreground text-center mt-5">
          ليس لديك حساب؟{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">أنشئ حساباً جديداً — تجربة مجانية 3 أيام</Link>
        </p>

        <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          يتم التحقق من بياناتك مباشرة على نظام ERPNext أو Odoo الخاص بك — نفس حسابك هناك يعمل هنا،
          ولا تُخزَّن كلمة مرورك في هذا التطبيق.
        </p>
      </Card>
    </div>
  );
}
