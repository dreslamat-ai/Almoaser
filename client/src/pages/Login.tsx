import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, LogIn, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.loginWithErp.useMutation({
    onSuccess: async (data) => {
      toast.success(`مرحباً ${data.name}! تم تسجيل الدخول بنجاح`);
      await utils.auth.me.invalidate();
      navigate("/erp");
    },
    onError: (err) => {
      toast.error(err.message || "تعذّر تسجيل الدخول");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("أدخل البريد الإلكتروني وكلمة المرور");
      return;
    }
    loginMutation.mutate({ email: email.trim(), password });
  };

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
              disabled={loginMutation.isPending}
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
                disabled={loginMutation.isPending}
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

          <Button type="submit" className="w-full h-11 gap-2" disabled={loginMutation.isPending}>
            {loginMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحقق من حسابك...</>
              : <><LogIn className="w-4 h-4" /> تسجيل الدخول</>}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-5">
          ليس لديك حساب؟{" "}
          <Link href="/signup" className="text-primary font-medium hover:underline">أنشئ حساباً جديداً — تجربة مجانية 3 أيام</Link>
        </p>

        <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          يتم التحقق من بياناتك مباشرة على نظام ERPNext — نفس حسابك هناك يعمل هنا،
          ولا تُخزَّن كلمة مرورك في هذا التطبيق.
        </p>
      </Card>
    </div>
  );
}
