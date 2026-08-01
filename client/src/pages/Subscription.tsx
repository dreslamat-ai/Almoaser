import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Zap, Bot, BookOpen, Crown, Coins, Plus, History, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toArabicDigits, digitsOnly } from "@shared/digits";
import { TOPUP_MIN_CREDITS, CREDITS_PER_SAR, topupPriceSAR, formatSAR } from "@shared/credits";
import { withVat } from "@shared/tax";
import { planCapacityLabel } from "@shared/planDisplay";

export default function Subscription() {
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [showHistory, setShowHistory] = useState(false);
  const [customTopup, setCustomTopup] = useState("");
  const [coupon, setCoupon] = useState("");
  const [couponInfo, setCouponInfo] = useState<{ ok: boolean; discount?: number; total?: number; reason?: string } | null>(null);
  const { data: subscription } = trpc.subscription.get.useQuery(undefined, { enabled: isAuthenticated });
  const { data: plans } = trpc.plans.list.useQuery();
  const { data: creditsInfo } = trpc.credits.balance.useQuery(undefined, { enabled: isAuthenticated });
  const { data: usageSummary } = trpc.credits.usageSummary.useQuery(undefined, { enabled: isAuthenticated });
  const { data: txns } = trpc.credits.transactions.useQuery(undefined, { enabled: isAuthenticated && showHistory });
  const { data: payCfg } = trpc.payments.isConfigured.useQuery(undefined, { enabled: isAuthenticated });

  const createMutation = trpc.subscription.create.useMutation({
    onSuccess: () => { toast.success("تم تفعيل الاشتراك بنجاح!"); utils.subscription.get.invalidate(); utils.credits.balance.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  // تغيير الباقة يتطلب دفعاً فورياً عبر MyFatoorah دائماً — حتى لو كان الحساب لسه
  // في فترة التجربة، اختيار باقة جديدة يُنهي التجربة فوراً ويحوّل العميل للدفع
  const switchPlanMutation = trpc.payments.createSubscriptionPayment.useMutation({
    onSuccess: (res) => { window.location.href = res.paymentUrl; },
    onError: (e) => toast.error(e.message),
  });
  const couponPreview = trpc.coupons.preview.useMutation({
    onSuccess: r => {
      setCouponInfo(r.ok ? { ok: true, discount: r.discount, total: r.total } : { ok: false, reason: r.reason });
      if (!r.ok) toast.error(r.reason);
    },
    onError: e => { setCouponInfo({ ok: false, reason: e.message }); toast.error(e.message); },
  });
  const topupMutation = trpc.payments.createTopupPayment.useMutation({
    onSuccess: (res) => { window.location.href = res.paymentUrl; },
    onError: (e) => toast.error(e.message),
  });
  const switchBillingMutation = trpc.subscription.switchBilling.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(vars.billing === "yearly" ? "تم التحويل إلى الفوترة السنوية بخصم 15%!" : "تم التحويل إلى الفوترة الشهرية");
      utils.subscription.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  const planIcons = [<BookOpen className="w-6 h-6" />, <Zap className="w-6 h-6" />, <Bot className="w-6 h-6" />];
  const currentPlan = plans?.find(p => p.id === subscription?.planId);
  const paymentsReady = payCfg?.configured ?? false;

  const creditsPct = creditsInfo && creditsInfo.monthlyCredits > 0
    ? Math.min(100, Math.round((creditsInfo.balance / creditsInfo.monthlyCredits) * 100))
    : 0;

  const handleTopup = (credits: number) => {
    if (!paymentsReady) {
      toast.info("بوابة الدفع قيد التفعيل — سيتوفر شحن النقاط قريباً");
      return;
    }
    if (!Number.isInteger(credits) || credits < TOPUP_MIN_CREDITS) {
      toast.error(`أقل شحنة ${toArabicDigits(TOPUP_MIN_CREDITS)} نقطة`);
      return;
    }
    topupMutation.mutate({ credits, couponCode: couponInfo?.ok ? coupon.trim() : undefined });
  };

  // الحقل يحتفظ بأرقام لاتينية داخلياً ويُعرض هندياً — الحساب يحتاج رقماً لا نصاً
  const customCredits = Number(customTopup || 0);
  const customValid = Number.isInteger(customCredits) && customCredits >= TOPUP_MIN_CREDITS;

  const handleSwitchPlan = (planId: number) => {
    if (!paymentsReady) {
      toast.info("بوابة الدفع قيد التفعيل — سيتوفر تغيير الباقة قريباً");
      return;
    }
    switchPlanMutation.mutate({ planId, billing, couponCode: couponInfo?.ok ? coupon.trim() : undefined });
  };

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/subscription" />
      <main className="flex-1 p-4 md:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">إدارة الاشتراك</h1>
          <p className="text-muted-foreground mt-1">اختر الباقة المناسبة لعملك وتابع رصيد نقاطك — الأسعار لا تشمل ضريبة القيمة المضافة (15%)</p>
        </div>

        {/* بطاقة الاشتراك الحالي + الرصيد */}
        {subscription && (
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            <div className="bg-navy-gradient rounded-2xl p-6 text-white">
              <div className="flex items-center gap-4">
                <Crown className="w-10 h-10 text-gold" />
                <div>
                  <div className="font-bold text-xl">{currentPlan?.nameAr ?? "باقة نشطة"}</div>
                  <div className="text-white/70 text-sm">
                    الحالة: {subscription.status === "active" ? "✅ نشط" : "🔄 تجريبي"} •
                    {currentPlan ? ` ${Number(currentPlan.price).toLocaleString("ar-SA")} ريال/شهر` : ""}
                    {subscription.billing === "yearly" ? " • فوترة سنوية (خصم 15%)" : ""}
                  </div>
                </div>
              </div>
              {/* زر التحويل الشهري ⇄ السنوي مع عرض المبلغ والخصم */}
              {currentPlan && subscription.billing !== "yearly" && (() => {
                const monthly = Number(currentPlan.price);
                const pct = currentPlan.yearlyDiscountPct ?? 15;
                const yearlyTotal = Math.round(monthly * 12 * (1 - pct / 100));
                const saved = monthly * 12 - yearlyTotal;
                return (
                  <div className="mt-4 pt-4 border-t border-white/15">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-sm">
                        <span className="text-white/80">الدفع السنوي: </span>
                        <span className="font-bold text-gold-ink">{yearlyTotal.toLocaleString("ar-SA")} ريال/سنة</span>
                        <span className="text-white/60 text-xs"> بدلاً من {(monthly * 12).toLocaleString("ar-SA")} ريال</span>
                        <div className="text-xs text-emerald-300 mt-0.5">توفّر {saved.toLocaleString("ar-SA")} ريال (خصم {pct}%)</div>
                      </div>
                      <Button size="sm" className="bg-gold text-navy hover:bg-gold/90 font-bold"
                        disabled={switchBillingMutation.isPending}
                        onClick={() => switchBillingMutation.mutate({ billing: "yearly" })}>
                        التحويل إلى سنوي
                      </Button>
                    </div>
                    <p className="text-[10px] text-white/50 mt-1.5">الأسعار لا تشمل ضريبة القيمة المضافة (15%)</p>
                  </div>
                );
              })()}
              {currentPlan && subscription.billing === "yearly" && (
                <div className="mt-4 pt-4 border-t border-white/15 flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-xs text-emerald-300">أنت على الفوترة السنوية — توفّر {Math.round(Number(currentPlan.price) * 12 * ((currentPlan.yearlyDiscountPct ?? 15) / 100)).toLocaleString("ar-SA")} ريال سنوياً</span>
                  <Button size="sm" variant="outline" className="border-white/30 text-white hover:bg-white/10 text-xs h-7"
                    disabled={switchBillingMutation.isPending}
                    onClick={() => switchBillingMutation.mutate({ billing: "monthly" })}>
                    العودة للشهري
                  </Button>
                </div>
              )}
            </div>
            {/* بطاقة رصيد النقاط */}
            <div className="bg-white rounded-2xl p-6 border-2 border-gold/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Coins className="w-6 h-6 text-gold-ink" />
                  <span className="font-bold text-navy">رصيد النقاط</span>
                </div>
                <button onClick={() => setShowHistory(v => !v)} className="text-xs text-muted-foreground hover:text-navy flex items-center gap-1">
                  <History className="w-3.5 h-3.5" /> السجل
                </button>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-3xl font-bold text-navy">{creditsInfo?.balance ?? 0}</span>
                <span className="text-muted-foreground text-sm">/ {creditsInfo?.monthlyCredits ?? 0} نقطة شهرياً</span>
              </div>
              <div className="w-full h-2 rounded-full bg-gray-100 mb-3">
                <div className="h-2 rounded-full bg-gold transition-all" style={{ width: `${creditsPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mb-3">كل رسالة للوكيل = نقطة واحدة • كل مستند = 5 نقاط • يتجدد الرصيد شهرياً</p>
              <div className="flex flex-wrap gap-2">
                {[500, 1000, 2000, 5000].map(c => (
                  <Button key={c} size="sm" variant="outline" className="border-gold/50 text-gold-ink hover:bg-gold/10 gap-1"
                    disabled={topupMutation.isPending} onClick={() => handleTopup(c)}>
                    <Plus className="w-3.5 h-3.5" /> {toArabicDigits(c)} نقطة — {toArabicDigits(formatSAR(topupPriceSAR(c)))} ريال
                  </Button>
                ))}
              </div>

              {/* مبلغ مخصّص: الأزرار الجاهزة لا تغطي من يحتاج عدداً بعينه */}
              <form
                className="flex items-end gap-2 mt-3"
                onSubmit={e => { e.preventDefault(); handleTopup(customCredits); }}
              >
                <div className="flex-1">
                  <label htmlFor="custom-topup" className="block text-xs text-muted-foreground mb-1">
                    أو اكتب عدد النقاط
                  </label>
                  <Input
                    id="custom-topup"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={toArabicDigits(TOPUP_MIN_CREDITS)}
                    // يُعرض هندياً ويُخزَّن لاتينياً، ويقبل ما تكتبه أي لوحة مفاتيح
                    value={toArabicDigits(customTopup)}
                    onChange={e => setCustomTopup(digitsOnly(e.target.value))}
                    aria-describedby="custom-topup-hint"
                    aria-invalid={customTopup !== "" && !customValid}
                    className="h-11"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  className="h-11 bg-gold text-navy hover:bg-gold-dark gap-1 shrink-0"
                  disabled={topupMutation.isPending || !customValid}
                >
                  <Plus className="w-3.5 h-3.5" /> اشحن
                </Button>
              </form>
              {/* كوبون الخصم — يُتحقق منه قبل الدفع بنفس حساب السيرفر */}
              <div className="mt-3 pt-3 border-t border-gold/20">
                <label htmlFor="coupon" className="block text-xs text-muted-foreground mb-1">كوبون خصم (اختياري)</label>
                <div className="flex gap-2">
                  <Input id="coupon" value={coupon} autoComplete="off"
                    onChange={e => { setCoupon(e.target.value.toUpperCase()); setCouponInfo(null); }}
                    placeholder="أدخل الرمز" className="h-10 text-sm uppercase" />
                  <Button size="sm" variant="outline" className="h-10 shrink-0 text-xs"
                    disabled={!coupon.trim() || couponPreview.isPending || !customValid}
                    onClick={() => couponPreview.mutate({ code: coupon.trim(), scope: "topup", netSar: topupPriceSAR(customCredits) })}>
                    تطبيق
                  </Button>
                </div>
                {!customValid && coupon.trim() && (
                  <p className="text-[11px] text-muted-foreground mt-1">أدخل عدد النقاط أولاً لحساب الخصم</p>
                )}
                {couponInfo?.ok && (
                  <p className="text-[11px] text-emerald-700 mt-1">
                    خصم {toArabicDigits(formatSAR(couponInfo.discount ?? 0))} ريال · الإجمالي بعد الضريبة {toArabicDigits(formatSAR(couponInfo.total ?? 0))} ريال
                  </p>
                )}
                {couponInfo && !couponInfo.ok && (
                  <p className="text-[11px] text-red-600 mt-1">{couponInfo.reason}</p>
                )}
              </div>
              <p id="custom-topup-hint" className="text-[11px] text-muted-foreground mt-1">
                {customTopup !== "" && !customValid
                  ? `أقل شحنة ${toArabicDigits(TOPUP_MIN_CREDITS)} نقطة`
                  : customValid
                    ? (() => {
                        const { net, vat, total } = withVat(topupPriceSAR(customCredits));
                        return `${toArabicDigits(customCredits)} نقطة — ${toArabicDigits(formatSAR(net))} + ${toArabicDigits(formatSAR(vat))} ضريبة = ${toArabicDigits(formatSAR(total))} ريال`;
                      })()
                    : `أقل شحنة ${toArabicDigits(TOPUP_MIN_CREDITS)} نقطة · كل ريال يشتري ${toArabicDigits(CREDITS_PER_SAR)} نقاط · تُضاف ١٥٪ ضريبة عند الدفع`}
              </p>
              {!paymentsReady && <p className="text-[11px] text-muted-foreground mt-2">بوابة الدفع قيد التفعيل — شحن النقاط سيتوفر قريباً</p>}
            </div>
          </div>
        )}

        {/* ملخص الاستهلاك: إجمالي المستندات/الرسائل + تفصيل لكل مستخدم في الحساب */}
        {usageSummary && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-navy" />
              <h3 className="font-bold text-navy text-sm">استهلاك الحساب</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-navy">{usageSummary.totalDocuments}</div>
                <div className="text-xs text-muted-foreground">مستند</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-navy">{usageSummary.totalMessages}</div>
                <div className="text-xs text-muted-foreground">رسالة</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-xl font-bold text-gold-ink">{usageSummary.totalCreditsConsumed}</div>
                <div className="text-xs text-muted-foreground">نقطة مستهلكة</div>
              </div>
            </div>
            {usageSummary.byMember.length > 1 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">التفصيل حسب المستخدم</h4>
                <div className="space-y-2">
                  {usageSummary.byMember.map(m => (
                    <div key={m.userId} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                      <span className="font-medium text-navy">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.documents} مستند • {m.messages} رسالة</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* سجل حركات النقاط */}
        {showHistory && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-8">
            <h3 className="font-bold text-navy mb-3 text-sm">سجل حركات النقاط</h3>
            {!txns?.length ? (
              <p className="text-sm text-muted-foreground">لا توجد حركات بعد.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {txns.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
                    <span className="text-muted-foreground">{t.note ?? t.type}</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${t.amount > 0 ? "text-green-600" : "text-red-500"}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</span>
                      <span className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleDateString("ar-SA")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-navy">{subscription ? "تغيير الباقة" : "اختر باقتك"}</h2>
            {subscription?.status === "trial" && (
              <p className="text-xs text-muted-foreground mt-1">تغيير الباقة الآن ينهي الفترة التجريبية فوراً ويحوّلك لإتمام الدفع.</p>
            )}
          </div>
          {/* مبدّل الفوترة */}
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white border border-gray-200">
            <button onClick={() => setBilling("monthly")}
              className={`px-4 py-1.5 [@media(pointer:coarse)]:min-h-11 rounded-full text-sm font-medium transition-all ${billing === "monthly" ? "bg-navy text-white" : "text-muted-foreground"}`}>شهري</button>
            <button onClick={() => setBilling("yearly")}
              className={`px-4 py-1.5 [@media(pointer:coarse)]:min-h-11 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${billing === "yearly" ? "bg-navy text-white" : "text-muted-foreground"}`}>
              سنوي <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${billing === "yearly" ? "bg-gold text-navy" : "bg-gold/15 text-gold-ink"}`}>-15%</span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {plans?.map((plan, i) => {
            const features: string[] = plan.features ? JSON.parse(plan.features) : [];
            const isCurrent = subscription?.planId === plan.id;
            const isPopular = i === 1;
            const monthly = Number(plan.price);
            const discountPct = plan.yearlyDiscountPct ?? 15;
            const yearlyTotal = Math.round(monthly * 12 * (1 - discountPct / 100));
            const yearlyPerMonth = Math.round(yearlyTotal / 12);
            return (
              <div key={plan.id} className={`rounded-2xl border-2 bg-white p-6 relative ${isCurrent ? "border-gold" : isPopular ? "border-navy" : "border-gray-200"}`}>
                {isCurrent && <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-gold text-navy text-xs font-bold px-3 py-1 rounded-full">باقتك الحالية</div>}
                {isPopular && !isCurrent && <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-navy text-white text-xs font-bold px-3 py-1 rounded-full">الأكثر طلباً</div>}
                <div className={`w-12 h-12 rounded-xl mb-4 flex items-center justify-center ${isPopular ? "bg-navy-gradient text-white" : "bg-gray-100 text-navy"}`}>{planIcons[i]}</div>
                <h3 className="text-xl font-bold text-navy mb-1">{plan.nameAr}</h3>
                {billing === "monthly" ? (
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-3xl font-bold text-navy">{monthly.toLocaleString("ar-SA")}</span>
                    <span className="text-muted-foreground text-sm">ريال / شهر</span>
                  </div>
                ) : (
                  <div className="mb-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-navy">{yearlyPerMonth.toLocaleString("ar-SA")}</span>
                      <span className="text-muted-foreground text-sm">ريال / شهر</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="line-through">{(monthly * 12).toLocaleString("ar-SA")}</span>
                      <span className="text-gold-ink font-bold mr-1"> {yearlyTotal.toLocaleString("ar-SA")} ريال سنوياً</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-4 text-[11px] font-medium">
                  <span className="px-2 py-0.5 rounded-full bg-navy/5 text-navy">{planCapacityLabel(plan)}</span>
                  <span className="px-2 py-0.5 rounded-full bg-gold/10 text-gold-ink">{plan.monthlyCredits ?? 150} نقطة/شهر</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent && subscription?.billing === billing ? (
                  <Button disabled className="w-full" variant="outline">باقتك الحالية</Button>
                ) : subscription && isCurrent ? (
                  // نفس الباقة، تغيير دورة الفوترة فقط — يستخدم التحويل المجاني (نفس زر البطاقة العلوية)
                  <Button onClick={() => switchBillingMutation.mutate({ billing })} disabled={switchBillingMutation.isPending}
                    className={`w-full ${isPopular ? "bg-navy-gradient text-white" : "border-navy text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}>
                    {switchBillingMutation.isPending ? "جاري التحديث..." : "تغيير دورة الفوترة"}
                  </Button>
                ) : subscription ? (
                  <Button onClick={() => handleSwitchPlan(plan.id)} disabled={switchPlanMutation.isPending}
                    className={`w-full ${isPopular ? "bg-navy-gradient text-white" : "border-navy text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}>
                    {switchPlanMutation.isPending
                      ? "جاري التحويل للدفع..."
                      : currentPlan && monthly < Number(currentPlan.price)
                        ? "تخفيض إلى هذه الباقة"
                        : "ترقية إلى هذه الباقة"}
                  </Button>
                ) : (
                  <Button onClick={() => createMutation.mutate({ planId: plan.id, billing })} disabled={createMutation.isPending}
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
