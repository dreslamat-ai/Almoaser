import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
    <div className="auth-shell" dir="rtl">
      <div className="auth-card max-w-md text-center">
        {state === "verifying" && (
          <>
            <div className="m-icon m-icon--lg mx-auto"><Loader2 className="w-7 h-7 animate-spin" /></div>
            <h1 className="text-xl font-bold mt-5 text-navy">جارٍ تأكيد بريدك الإلكتروني...</h1>
          </>
        )}
        {state === "done" && (
          <>
            <div className="m-icon m-icon--ok m-icon--lg mx-auto"><CheckCircle2 className="w-7 h-7" /></div>
            <h1 className="text-xl font-bold mt-5 text-navy">تم التأكيد بنجاح 🎉</h1>
            <p className="text-sm text-muted-foreground mt-2">{message}</p>
            <p className="text-xs text-muted-foreground mt-1">ستصلك الآن الإشعارات والتذكيرات وفواتير الدفع على بريدك.</p>
          </>
        )}
        {state === "error" && (
          <>
            <div className="m-icon m-icon--danger m-icon--lg mx-auto"><XCircle className="w-7 h-7" /></div>
            <h1 className="text-xl font-bold mt-5 text-navy">تعذّر تأكيد البريد</h1>
            <p className="text-sm text-muted-foreground mt-2">{message}</p>
            <p className="text-xs text-muted-foreground mt-1">يمكنك طلب رابط جديد من صفحة إعدادات الحساب.</p>
          </>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-7">
          <Link href="/settings" className="flex-1"><Button variant="outline" className="w-full h-12 border-navy/25 text-navy">إعدادات الحساب</Button></Link>
          <Link href="/erp" className="flex-1"><Button className="w-full h-12 font-semibold">الذهاب للنظام</Button></Link>
        </div>
      </div>
    </div>
  );
}
