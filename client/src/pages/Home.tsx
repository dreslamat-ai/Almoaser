import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  BookOpen, Bot, CheckCircle2, ChevronDown, DollarSign, FileText,
  BarChart3, Shield, Users, Zap, MessageCircle, Phone, Mail, Building2,
  ArrowLeft, Star, Clock, TrendingUp
} from "lucide-react";

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-white/95 backdrop-blur-xl shadow-sm border-b border-gray-100" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-navy-gradient flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg text-navy">Almoaser <span className="text-gold font-light text-sm">AI Powered ERP</span></span>
            <div className="text-[10px] text-muted-foreground leading-none">خدمات مسك الدفاتر</div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          {[{ label: "الخدمات", href: "#services" }, { label: "الباقات", href: "#pricing" }, { label: "كيف نعمل", href: "#how" }, { label: "تواصل معنا", href: "#contact" }].map(l => (
            <a key={l.href} href={l.href} className="hover:text-navy transition-colors">{l.label}</a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <Button onClick={() => navigate("/dashboard")} className="bg-navy-gradient text-white hover:opacity-90">
              لوحة التحكم
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => startLogin()} className="text-navy">تسجيل الدخول</Button>
              <Button onClick={() => startLogin()} className="bg-navy-gradient text-white hover:opacity-90">ابدأ مجاناً</Button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function HeroSection() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  return (
    <section className="bg-navy-hero min-h-screen flex items-center relative overflow-hidden pt-16">
      <div className="absolute inset-0 opacity-10">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="absolute w-px bg-white/20"
            style={{ right: `${(i + 1) * 5}%`, top: 0, bottom: 0, opacity: Math.random() * 0.3 }} />
        ))}
      </div>
      <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-gold/10 blur-3xl" />
      <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full bg-white/5 blur-3xl" />
      <div className="container relative z-10 py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 mb-8 animate-fade-in-up">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            <span className="text-white/80 text-sm">منصة مسك الدفاتر الذكية #1 في المملكة</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white leading-tight mb-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            وكلاء ذكاء اصطناعي<br />
            <span className="text-gold">يمسكون دفاترك</span><br />
            بدلاً عنك
          </h1>
          <p className="text-white/70 text-xl leading-relaxed mb-10 max-w-2xl animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            بدلاً من محاسب يعمل 8 ساعات، وظّف وكيل AI يعمل 24/7 — يُدخل الفواتير، يُسجّل القيود، ويُنتج التقارير عبر رسالة واتساب واحدة.
          </p>
          <div className="flex flex-wrap gap-4 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            {isAuthenticated ? (
              <Button size="lg" onClick={() => navigate("/dashboard")}
                className="bg-gold text-white hover:bg-gold/90 text-base px-8 py-4 h-auto">
                الذهاب للوحة التحكم
                <ArrowLeft className="w-5 h-5 mr-2" />
              </Button>
            ) : (
              <Button size="lg" onClick={() => startLogin()}
                className="bg-gold text-white hover:bg-gold/90 text-base px-8 py-4 h-auto">
                ابدأ تجربتك المجانية
                <ArrowLeft className="w-5 h-5 mr-2" />
              </Button>
            )}
            <Button size="lg" variant="outline"
              className="border-white/30 text-white bg-white/10 hover:bg-white/20 text-base px-8 py-4 h-auto"
              onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}>
              عرض الباقات
            </Button>
          </div>
          <div className="flex flex-wrap gap-8 mt-12 animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            {[
              { value: "+200", label: "عميل نشط" },
              { value: "24/7", label: "وقت العمل" },
              { value: "90%", label: "توفير في الوقت" },
              { value: "5 ثوانٍ", label: "لإنشاء فاتورة" },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-3xl font-bold text-gold">{s.value}</div>
                <div className="text-white/60 text-sm">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/40 animate-bounce">
        <span className="text-xs">اسحب للأسفل</span>
        <ChevronDown className="w-4 h-4" />
      </div>
    </section>
  );
}

function ServicesSection() {
  const { ref, inView } = useInView();
  const services = [
    { icon: <BookOpen className="w-6 h-6" />, title: "مسك الدفاتر", desc: "تسجيل جميع العمليات المالية اليومية بدقة واحترافية عبر وكيل AI متخصص.", color: "text-blue-600", bg: "bg-blue-50" },
    { icon: <FileText className="w-6 h-6" />, title: "إدارة الفواتير", desc: "إنشاء واعتماد فواتير المبيعات والمشتريات تلقائياً عبر رسالة واتساب.", color: "text-green-600", bg: "bg-green-50" },
    { icon: <DollarSign className="w-6 h-6" />, title: "القيود المحاسبية", desc: "تسجيل القيود اليومية والتسويات بدقة مع مراجعة فورية من الوكيل.", color: "text-yellow-600", bg: "bg-yellow-50" },
    { icon: <BarChart3 className="w-6 h-6" />, title: "التقارير المالية", desc: "ميزانية، قائمة دخل، تقرير الذمم — جاهزة في ثوانٍ بأمر نصي.", color: "text-purple-600", bg: "bg-purple-50" },
    { icon: <Users className="w-6 h-6" />, title: "إدارة الرواتب", desc: "حساب الرواتب والمستحقات وإنشاء قيودها المحاسبية تلقائياً.", color: "text-red-600", bg: "bg-red-50" },
    { icon: <Shield className="w-6 h-6" />, title: "الامتثال الضريبي", desc: "احتساب ضريبة القيمة المضافة وإعداد الإقرارات الضريبية الدورية.", color: "text-teal-600", bg: "bg-teal-50" },
  ];
  return (
    <section id="services" className="py-24 bg-gray-50" ref={ref}>
      <div className="container">
        <div className={`text-center mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy/10 text-navy text-sm font-medium mb-4">
            <Zap className="w-4 h-4" />
            خدماتنا
          </div>
          <h2 className="text-4xl font-bold text-navy mb-4">كل ما تحتاجه لإدارة محاسبتك</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">وكلاء AI متخصصون لكل قسم، يعملون بتناسق تام مع نظام Almoaser AI Powered ERP الخاص بك.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((s, i) => (
            <div key={i} className={`card-navy p-6 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className={`w-12 h-12 rounded-xl ${s.bg} ${s.color} flex items-center justify-center mb-4`}>{s.icon}</div>
              <h3 className="font-bold text-lg text-navy mb-2">{s.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const { ref, inView } = useInView();
  const steps = [
    { num: "01", title: "مقابلة وتحليل النشاط", desc: "نفهم طبيعة عملك ومتطلباتك المحاسبية لنخصص الوكيل المناسب.", icon: <Users className="w-5 h-5" /> },
    { num: "02", title: "تحديد الباقة المناسبة", desc: "تختار الباقة التي تناسب حجم عملياتك وميزانيتك.", icon: <Star className="w-5 h-5" /> },
    { num: "03", title: "التعاقد والتوقيع", desc: "توقيع الاتفاقية وتحديد نطاق الخدمة وآلية التواصل.", icon: <FileText className="w-5 h-5" /> },
    { num: "04", title: "تهيئة النظام المحاسبي", desc: "إعداد Almoaser AI Powered ERP وضبط الوكلاء وفق خطة حسابات شركتك.", icon: <Bot className="w-5 h-5" /> },
    { num: "05", title: "البدء في التنفيذ", desc: "ترسل أوامرك عبر واتساب والوكيل ينفذها فوراً في النظام.", icon: <MessageCircle className="w-5 h-5" /> },
    { num: "06", title: "المراجعة والتحسين", desc: "تقارير دورية ومراجعة مستمرة لضمان دقة البيانات.", icon: <TrendingUp className="w-5 h-5" /> },
  ];
  return (
    <section id="how" className="py-24" ref={ref}>
      <div className="container">
        <div className={`text-center mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gold/10 text-gold-dark text-sm font-medium mb-4">
            <Clock className="w-4 h-4" />
            كيف نعمل
          </div>
          <h2 className="text-4xl font-bold text-navy mb-4">ستة خطوات للبدء</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">من أول اتصال حتى تشغيل وكيل AI خاص بشركتك في أقل من أسبوع.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {steps.map((s, i) => (
            <div key={i} className={`relative p-6 rounded-2xl border border-gray-100 bg-white hover:shadow-md transition-shadow ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="flex items-start gap-4">
                <div className="text-4xl font-bold text-navy/10 leading-none">{s.num}</div>
                <div className="flex-1">
                  <div className="w-10 h-10 rounded-xl bg-navy-gradient text-white flex items-center justify-center mb-3">{s.icon}</div>
                  <h3 className="font-bold text-navy mb-2">{s.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{s.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  const { ref, inView } = useInView();
  const { data: plans, isLoading } = trpc.plans.list.useQuery();
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const planIcons = [<BookOpen className="w-6 h-6" />, <Zap className="w-6 h-6" />, <Bot className="w-6 h-6" />];
  const planColors = ["border-gray-200", "border-navy shadow-lg scale-105", "border-gold"];
  const planBadges = ["", "الأكثر طلباً", ""];

  return (
    <section id="pricing" className="py-24 bg-gray-50" ref={ref}>
      <div className="container">
        <div className={`text-center mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy/10 text-navy text-sm font-medium mb-4">
            <DollarSign className="w-4 h-4" />
            الباقات والأسعار
          </div>
          <h2 className="text-4xl font-bold text-navy mb-4">باقات تناسب جميع الأعمال</h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">أسعار شهرية شاملة بدون رسوم خفية. يمكنك الترقية أو الإلغاء في أي وقت.</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6 items-center">
            {plans?.map((plan, i) => {
              const features: string[] = plan.features ? JSON.parse(plan.features) : [];
              const isPopular = i === 1;
              return (
                <div key={plan.id} className={`rounded-2xl border-2 ${planColors[i]} bg-white p-8 relative ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.1}s` }}>
                  {planBadges[i] && (
                    <div className="absolute -top-4 right-1/2 translate-x-1/2 bg-navy text-white text-xs font-bold px-4 py-1.5 rounded-full">
                      {planBadges[i]}
                    </div>
                  )}
                  <div className={`w-12 h-12 rounded-xl mb-4 flex items-center justify-center ${isPopular ? "bg-navy-gradient text-white" : "bg-gray-100 text-navy"}`}>
                    {planIcons[i]}
                  </div>
                  <h3 className="text-xl font-bold text-navy mb-1">{plan.nameAr}</h3>
                  <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-4xl font-bold text-navy">{Number(plan.price).toLocaleString("ar-SA")}</span>
                    <span className="text-muted-foreground">ريال / شهر</span>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {features.map((f, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                        <span className="text-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className={`w-full ${isPopular ? "bg-navy-gradient text-white hover:opacity-90" : "border-navy text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}
                    onClick={() => {
                      setSelectedPlanId(plan.id);
                      document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    ابدأ الآن
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ContactSection() {
  const { ref, inView } = useInView();
  const { data: plans } = trpc.plans.list.useQuery();
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");

  const [form, setForm] = useState({ name: "", email: "", phone: "", companyName: "", companyType: "", businessSector: "", planId: "", message: "" });

  // ─── عداد تنازلي للتوجيه إلى الباقات ─────────────────────────────────
  const [countdown, setCountdown] = useState(5);
  useEffect(() => {
    if (!submitted) return;
    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          // التمرير السلس إلى قسم الباقات
          const pricingSection = document.getElementById("pricing");
          if (pricingSection) {
            pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [submitted]);
  // ─────────────────────────────────────────────────────────────────────

  // ─── تحقق رقم الجوال السعودي ─────────────────────────────────────────
  const saudiPhoneRegex = /^(?:(?:\+|00)966|0)5[0-9]{8}$/;
  const [phoneTouched, setPhoneTouched] = useState(false);

  const getPhoneError = (value: string): string => {
    if (!value) return "رقم الجوال مطلوب";
    const cleaned = value.replace(/[\s\-]/g, "");
    if (cleaned.length < 10) return "رقم الجوال قصير جداً — يجب أن يكون 10 أرقام على الأقل";
    if (!cleaned.startsWith("05") && !cleaned.startsWith("+9665") && !cleaned.startsWith("009665"))
      return "يجب أن يبدأ الرقم بـ 05 أو +9665";
    if (!saudiPhoneRegex.test(cleaned))
      return "صيغة رقم الجوال السعودي غير صحيحة (مثال: 0512345678)";
    return "";
  };

  const phoneError = phoneTouched ? getPhoneError(form.phone) : "";
  const isPhoneValid = saudiPhoneRegex.test(form.phone.replace(/[\s\-]/g, ""));
  // ─────────────────────────────────────────────────────────────────────

  const submitMutation = trpc.register.submit.useMutation({
    onSuccess: () => {
      setSubmittedName(form.name);
      setSubmitted(true);
      setForm({ name: "", email: "", phone: "", companyName: "", companyType: "", businessSector: "", planId: "", message: "" });
      setPhoneTouched(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneTouched(true);
    if (!isPhoneValid) return;
    submitMutation.mutate({
      name: form.name,
      email: form.email,
      phone: form.phone,
      companyName: form.companyName || undefined,
      companyType: form.companyType || undefined,
      businessSector: form.businessSector || undefined,
      planId: form.planId ? Number(form.planId) : undefined,
      message: form.message || undefined,
    });
  };
  return (
    <section id="contact" className="py-24 bg-navy-hero" ref={ref}>
      <div className="container">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className={`${inView ? "animate-fade-in-up" : "opacity-0"}`}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-white/80 text-sm mb-6">
              <MessageCircle className="w-4 h-4" />
              تواصل معنا
            </div>
            <h2 className="text-4xl font-bold text-white mb-6">ابدأ رحلتك مع <span className="text-gold">Almoaser AI</span> اليوم</h2>
            <p className="text-white/70 text-lg leading-relaxed mb-8">
              احجز استشارتك المجانية الآن مع أحد خبرائنا المحاسبيين، وسنساعدك على اختيار الباقة المناسبة لعملك.
            </p>
            <div className="space-y-4">
              {[
                { icon: <Phone className="w-5 h-5" />, text: "+966 56 467 7377", href: "tel:+966564677377" },
                { icon: <Mail className="w-5 h-5" />, text: "info@almoaser.com", href: "mailto:info@almoaser.com" },
                { icon: <MessageCircle className="w-5 h-5" />, text: "واتساب متاح 24/7", href: "https://wa.me/966564677377" },
              ].map((c, i) => (
                <a key={i} href={c.href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 text-white/80 hover:text-white transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-white/10 group-hover:bg-white/20 flex items-center justify-center transition-colors">{c.icon}</div>
                  <span>{c.text}</span>
                </a>
              ))}
            </div>
          </div>
          <div className={`bg-white rounded-2xl p-8 shadow-2xl ${inView ? "animate-slide-in-right" : "opacity-0"}`}>
            {submitted ? (
              /* ─── رسالة الترحيب المتحركة ─── */
              <div className="flex flex-col items-center justify-center text-center py-6 animate-fade-in-up">
                {/* دائرة النجاح المتحركة */}
                <div className="relative mb-6">
                  <div className="w-24 h-24 rounded-full bg-green-50 border-4 border-green-200 flex items-center justify-center animate-[bounce_0.6s_ease-out]">
                    <CheckCircle2 className="w-12 h-12 text-green-500" strokeWidth={1.5} />
                  </div>
                  <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-gold/20 border-2 border-gold flex items-center justify-center animate-[spin_3s_linear_infinite]">
                    <Star className="w-4 h-4 text-gold" fill="currentColor" />
                  </div>
                </div>
                {/* نص الترحيب */}
                <h3 className="text-2xl font-bold text-navy mb-2">
                  أهلاً وسهلاً، <span className="text-gold">{submittedName}</span>! 🎉
                </h3>
                <p className="text-gray-600 text-sm leading-relaxed mb-6 max-w-xs">
                  تم استلام طلبك بنجاح. سيتواصل معك فريق <strong>Almoaser AI</strong> خلال <strong>24 ساعة</strong> لتحديد موعد الاستشارة المجانية.
                </p>
                {/* شريط العداد التنازلي */}
                <div className="w-full mb-5">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                    <span>سيتم توجيهك لاختيار الباقة خلال</span>
                    <span className="font-bold text-navy text-sm">{countdown} ثوانٍ</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-navy-gradient rounded-full transition-all duration-1000 ease-linear"
                      style={{ width: `${((5 - countdown) / 5) * 100}%` }}
                    />
                  </div>
                </div>
                {/* بطاقات الخطوات التالية */}
                <div className="w-full space-y-3 mb-5">
                  {[
                    { icon: <Phone className="w-4 h-4" />, text: "سيتصل بك مستشارنا قريباً", color: "text-blue-600 bg-blue-50" },
                    { icon: <MessageCircle className="w-4 h-4" />, text: "أو تواصل معنا عبر واتساب الآن", color: "text-green-600 bg-green-50" },
                    { icon: <CheckCircle2 className="w-4 h-4" />, text: "اختر الباقة المناسبة لعملك أدناه", color: "text-gold bg-yellow-50" },
                  ].map((step, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${step.color} animate-fade-in-up`}
                      style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                      <div className="flex-shrink-0">{step.icon}</div>
                      <span className="text-sm font-medium">{step.text}</span>
                    </div>
                  ))}
                </div>
                {/* أزرار الإجراء */}
                <div className="flex gap-3 w-full">
                  <a href="https://wa.me/966564677377?text=مرحباً، أريد الاستفسار عن خدمات Almoaser AI"
                    target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button className="w-full bg-green-500 hover:bg-green-600 text-white gap-2">
                      <MessageCircle className="w-4 h-4" />
                      واتساب الآن
                    </Button>
                  </a>
                  <Button
                    className="flex-1 bg-navy-gradient text-white gap-2 hover:opacity-90"
                    onClick={() => {
                      const pricingSection = document.getElementById("pricing");
                      if (pricingSection) pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <ArrowLeft className="w-4 h-4" />
                    اختر باقتك
                  </Button>
                </div>
              </div>
            ) : (
              /* ─── النموذج ─── */
              <>
                <h3 className="text-xl font-bold text-navy mb-6">طلب استشارة مجانية</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="name" className="text-navy font-medium">الاسم الكامل *</Label>
                      <Input id="name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="محمد أحمد" required className="mt-1" />
                    </div>
                    <div>
                      <Label htmlFor="phone" className="text-navy font-medium">رقم الجوال *</Label>
                      <div className="relative mt-1">
                        <Input
                          id="phone"
                          value={form.phone}
                          onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                          onBlur={() => setPhoneTouched(true)}
                          placeholder="0512345678"
                          dir="ltr"
                          maxLength={15}
                          className={`pl-9 transition-all duration-200 ${
                            phoneTouched
                              ? isPhoneValid
                                ? "border-green-400 focus-visible:ring-green-300 bg-green-50/40"
                                : form.phone
                                  ? "border-red-400 focus-visible:ring-red-300 bg-red-50/40"
                                  : "border-red-400 focus-visible:ring-red-300"
                              : ""
                          }`}
                        />
                        {phoneTouched && form.phone && (
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                            {isPhoneValid ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                              </svg>
                            )}
                          </div>
                        )}
                      </div>
                      <div className={`transition-all duration-300 overflow-hidden ${phoneError ? "max-h-8 mt-1" : "max-h-0"}`}>
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                          </svg>
                          {phoneError}
                        </p>
                      </div>
                      {!phoneTouched && (
                        <p className="text-xs text-gray-400 mt-1">الصيغ المقبولة: 0512345678 أو +966512345678</p>
                      )}
                      {phoneTouched && isPhoneValid && (
                        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> رقم جوال سعودي صحيح ✓
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="email" className="text-navy font-medium">البريد الإلكتروني *</Label>
                    <Input id="email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="example@company.com" required className="mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="company" className="text-navy font-medium">اسم الشركة *</Label>
                      <Input id="company" value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="شركة النور للتجارة" required className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-navy font-medium">نوع النشاط *</Label>
                      <Select value={form.companyType} onValueChange={v => setForm(f => ({ ...f, companyType: v }))}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="اختر النشاط" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="trading">تجارة</SelectItem>
                          <SelectItem value="services">خدمات</SelectItem>
                          <SelectItem value="manufacturing">تصنيع</SelectItem>
                          <SelectItem value="construction">مقاولات</SelectItem>
                          <SelectItem value="retail">تجزئة</SelectItem>
                          <SelectItem value="restaurant">مطاعم وضيافة</SelectItem>
                          <SelectItem value="healthcare">رعاية صحية</SelectItem>
                          <SelectItem value="education">تعليم وتدريب</SelectItem>
                          <SelectItem value="tech">تقنية معلومات</SelectItem>
                          <SelectItem value="real_estate">عقارات</SelectItem>
                          <SelectItem value="other">أخرى</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="businessSector" className="text-navy font-medium">مجال العمل التفصيلي</Label>
                    <Input id="businessSector" value={form.businessSector}
                      onChange={e => setForm(f => ({ ...f, businessSector: e.target.value }))}
                      placeholder="مثال: استيراد وتصدير مواد غذائية، مقاولات بنية تحتية..."
                      className="mt-1" />
                    <p className="text-xs text-gray-400 mt-1">اختياري — يساعدنا في تخصيص الخدمة لنشاطك</p>
                  </div>
                  <div>
                    <Label className="text-navy font-medium">الباقة المهتم بها</Label>
                    <Select value={form.planId} onValueChange={v => setForm(f => ({ ...f, planId: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="اختر الباقة" /></SelectTrigger>
                      <SelectContent>
                        {plans?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr} — {Number(p.price).toLocaleString("ar-SA")} ريال/شهر</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="message" className="text-navy font-medium">رسالة إضافية</Label>
                    <textarea id="message" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                      placeholder="أخبرنا عن احتياجاتك المحاسبية..." rows={3}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-navy/30" />
                  </div>
                  <Button type="submit" disabled={submitMutation.isPending} className="w-full bg-navy-gradient text-white hover:opacity-90 h-12 text-base">
                    {submitMutation.isPending ? (
                      <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />جاري الإرسال...</span>
                    ) : (
                      <span className="flex items-center gap-2"><ArrowLeft className="w-4 h-4" />إرسال الطلب</span>
                    )}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-navy-dark py-12 text-white/60">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-gold" />
            </div>
            <div>
              <div className="font-bold text-white">Almoaser <span className="text-gold text-sm font-light">AI Powered ERP</span></div>
              <div className="text-xs">خدمات مسك الدفاتر بالذكاء الاصطناعي</div>
            </div>
          </div>
          <div className="text-sm">© 2026 Almoaser AI Powered ERP — جميع الحقوق محفوظة</div>
          <div className="flex gap-4 text-sm">
            <a href="https://almoaser.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">الموقع الرئيسي</a>
            <a href="#contact" className="hover:text-white transition-colors">تواصل معنا</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <ServicesSection />
      <HowItWorksSection />
      <PricingSection />
      <ContactSection />
      <Footer />
    </div>
  );
}
