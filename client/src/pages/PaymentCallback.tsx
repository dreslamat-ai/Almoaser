import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

/**
 * صفحة العودة من بوابة الدفع MyFatoorah.
 * MyFatoorah تعيد التوجيه إلى: /payment/callback?paymentId=xxx (أو ?failed=1 عند الفشل)
 */
export default function PaymentCallback() {
  const [state, setState] = useState<"verifying" | "paid" | "failed">("verifying");
  const [purpose, setPurpose] = useState<string>("");
  const verifyMutation = trpc.payments.verifyPayment.useMutation();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const mfPaymentId = params.get("paymentId");
    const failed = params.get("failed");
    if (failed || !mfPaymentId) {
      setState("failed");
      return;
    }
    verifyMutation.mutate(
      { mfPaymentId },
      {
        onSuccess: (res) => {
          setPurpose(res.purpose);
          setState(res.status === "paid" ? "paid" : "failed");
        },
        onError: () => setState("failed"),
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 max-w-md w-full text-center">
        {state === "verifying" && (
          <>
            <Loader2 className="w-12 h-12 text-navy animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold text-navy mb-2">جارٍ التحقق من الدفع...</h1>
            <p className="text-muted-foreground text-sm">لحظات من فضلك، نتأكد من عملية الدفع مع بوابة MyFatoorah.</p>
          </>
        )}
        {state === "paid" && (
          <>
            <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-navy mb-2">تم الدفع بنجاح!</h1>
            <p className="text-muted-foreground text-sm mb-6">
              {purpose === "topup"
                ? "أُضيفت النقاط إلى رصيدك ويمكنك استخدامها فوراً."
                : "تم تفعيل اشتراكك وتعبئة رصيد نقاطك الشهري."}
            </p>
            <Link href="/subscription">
              <Button className="bg-navy-gradient text-white w-full">العودة إلى اشتراكي</Button>
            </Link>
          </>
        )}
        {state === "failed" && (
          <>
            <XCircle className="w-14 h-14 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-navy mb-2">لم تكتمل عملية الدفع</h1>
            <p className="text-muted-foreground text-sm mb-6">لم يتم خصم أي مبلغ، أو فشلت العملية في بوابة الدفع. يمكنك المحاولة مرة أخرى.</p>
            <Link href="/subscription">
              <Button variant="outline" className="border-navy text-navy w-full">العودة إلى اشتراكي</Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
