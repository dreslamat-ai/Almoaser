import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export default function VerifyEmail() {
  const [state, setState] = useState<"verifying" | "done" | "error">("verifying");
  const [message, setMessage] = useState("");
  const verifyMutation = trpc.email.verify.useMutation();
  // التوكن يُستهلك مرة واحدة — نمنع الاستدعاء المزدوج في وضع React StrictMode
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setMessage("الرابط غير مكتمل — لا يحتوي رمز التأكيد");
      return;
    }
    verifyMutation.mutateAsync({ token })
      .then(res => {
        setState("done");
        setMessage(`تم تأكيد بريدك: ${res.email}`);
      })
      .catch(err => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "تعذّر تأكيد البريد");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-100 p-4" dir="rtl">
      <Card className="w-full max-w-md p-8 text-center shadow-lg border-border/60">
        {state === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
            <h1 className="text-lg font-bold mt-4 text-foreground">جارٍ تأكيد بريدك الإلكتروني...</h1>
          </>
        )}
        {state === "done" && (
          <>
            <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" />
            <h1 className="text-xl font-bold mt-4 text-foreground">تم التأكيد بنجاح 🎉</h1>
            <p className="text-sm text-muted-foreground mt-2">{message}</p>
            <p className="text-xs text-muted-foreground mt-1">ستصلك الآن الإشعارات والتذكيرات وفواتير الدفع على بريدك.</p>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="w-14 h-14 mx-auto text-red-500" />
            <h1 className="text-xl font-bold mt-4 text-foreground">تعذّر تأكيد البريد</h1>
            <p className="text-sm text-muted-foreground mt-2">{message}</p>
            <p className="text-xs text-muted-foreground mt-1">يمكنك طلب رابط جديد من صفحة إعدادات الحساب.</p>
          </>
        )}
        <div className="flex gap-2 justify-center mt-6">
          <Link href="/settings"><Button variant="outline">إعدادات الحساب</Button></Link>
          <Link href="/erp"><Button>الذهاب للنظام</Button></Link>
        </div>
      </Card>
    </div>
  );
}
