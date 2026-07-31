import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Database, Smartphone, Mail } from "lucide-react";

const ICONS = {
  erp: <Database className="w-4 h-4" />,
  phone: <Smartphone className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
} as const;

/**
 * قسم إعداد الحساب — يبقى ظاهراً حتى تكتمل الخطوات الأساسية.
 *
 * عمداً لا يُخفى بعد فترة ولا يمكن إغلاقه نهائياً: العميل الذي بدأ التجربة
 * ببيانات تجريبية ولم يربط نظامه سيظن أن كل شيء يعمل على بياناته الحقيقية.
 * الربط وتأكيد الجوال خطوتان لا يجوز أن تُنسيا بصمت.
 */
export default function AccountSetupCard() {
  const [, navigate] = useLocation();
  const { data } = trpc.accountSetup.status.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (!data || !data.showBanner) return null;

  const done = data.steps.filter(s => s.done).length;
  const total = data.steps.length;

  return (
    <section
      aria-labelledby="setup-heading"
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3 mb-4">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 id="setup-heading" className="font-bold text-amber-900">أكمل إعداد حسابك</h2>
          <p className="text-[13px] text-amber-900/80 mt-0.5 leading-relaxed">
            حسابك يعمل الآن على <strong>بيانات تجريبية</strong>. اربط نظامك المحاسبي حتى تصبح كل عملية على بياناتك الحقيقية.
          </p>
        </div>
        <span className="text-xs font-medium text-amber-900/70 shrink-0" style={{ fontVariantNumeric: "tabular-nums" }}>
          {done}/{total}
        </span>
      </div>

      <ul className="space-y-2">
        {data.steps.map(step => (
          <li
            key={step.key}
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
              step.done ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-white"
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className={`shrink-0 ${step.done ? "text-emerald-600" : "text-amber-600"}`} aria-hidden="true">
                {step.done ? <CheckCircle2 className="w-4 h-4" /> : ICONS[step.key]}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${step.done ? "text-emerald-900 line-through" : "text-navy"}`}>
                  {step.title}
                  {!step.done && step.critical && (
                    <span className="mr-2 text-[10px] font-bold text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5 align-middle">
                      مطلوب
                    </span>
                  )}
                </p>
                {!step.done && <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.detail}</p>}
              </div>
            </div>
            {!step.done && (
              <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={() => navigate(step.href)}>
                {step.cta}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
