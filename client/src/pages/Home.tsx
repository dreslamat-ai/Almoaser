import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  BookOpen, Bot, CheckCircle2, ChevronDown, DollarSign, FileText,
  BarChart3, Shield, Users, Zap, MessageCircle, Phone, Mail, Menu, X,
  ArrowLeft, Star, Clock, Send, Sparkles, XCircle, ShieldCheck, Lock,
  Gauge, Target, Moon, Languages} from "lucide-react";
import { planCapacityLabel } from "@shared/planDisplay";
import { featuresForCard } from "@shared/planFeatures";
import { DELIVERABLES } from "@shared/deliverables";
import SalesChat from "@/components/SalesChat";

// ─── بيانات السيناريوهات التفاعلية ──────────────────────────────────────────
type ChatMessage = { from: "user" | "agent"; text: string; delay: number; type?: "text" | "pdf"; pdfName?: string; pdfSize?: string };
type Scenario = { id: number; label: string; icon: string; messages: ChatMessage[] };

const SCENARIOS: Scenario[] = [
  {
    id: 1,
    label: "إنشاء فاتورة",
    icon: "🧾",
    messages: [
      { from: "user",  text: "أصدر فاتورة لشركة النور بقيمة 5,000 ريال مقابل خدمات استشارية", delay: 0 },
      { from: "agent", text: "⏳ جاري البحث عن شركة النور في النظام...", delay: 900 },
      { from: "agent", text: "✅ تم إنشاء الفاتورة بنجاح!\n\n📄 رقم الفاتورة: SINV-2026-0042\n👤 العميل: شركة النور للتجارة\n💰 المبلغ: 5,000 ريال\n📅 تاريخ الاستحقاق: 2026-08-17\n\nهل أرسل الفاتورة هنا في المحادثة؟", delay: 2200 },
      { from: "user",  text: "نعم أرسلها هنا", delay: 3800 },
      { from: "agent", text: "⏳ جاري تحويل الفاتورة إلى PDF...", delay: 4800 },
      { from: "agent", text: "تفضل، الفاتورة جاهزة 👆", delay: 6000, type: "pdf", pdfName: "SINV-2026-0042 — شركة النور.pdf", pdfSize: "142 KB" },
    ],
  },
  {
    id: 2,
    label: "قيد محاسبي",
    icon: "📒",
    messages: [
      { from: "user",  text: "سجّل قيد: مدين حساب الصندوق 3,000 ريال، دائن المبيعات 3,000 ريال", delay: 0 },
      { from: "agent", text: "⏳ جاري التحقق من الحسابات...", delay: 800 },
      { from: "agent", text: "✅ تم تسجيل القيد المحاسبي!\n\n📋 رقم القيد: JV-2026-0189\n📅 التاريخ: 2026-07-17\n\n┌─ مدين: الصندوق — 3,000 ريال\n└─ دائن: المبيعات — 3,000 ريال\n\nالقيد معتمد ومسجّل في دفتر الأستاذ ✓", delay: 2000 },
    ],
  },
  {
    id: 3,
    label: "تقرير مبيعات",
    icon: "📊",
    messages: [
      { from: "user",  text: "ما إجمالي مبيعات هذا الشهر مقارنةً بالشهر الماضي؟", delay: 0 },
      { from: "agent", text: "⏳ جاري استخراج تقرير المبيعات...", delay: 700 },
      { from: "agent", text: "📊 تقرير المبيعات — يوليو 2026\n\n💹 هذا الشهر: 127,450 ريال\n📉 الشهر الماضي: 98,200 ريال\n📈 نسبة النمو: +29.8%\n\n🏆 أعلى عميل: شركة الفجر (32,000 ريال)\n📦 أكثر منتج مبيعاً: خدمات الاستشارات\n\nهل تريد التقرير التفصيلي؟", delay: 1800 },
      { from: "user",  text: "أرسله على الإيميل", delay: 3200 },
      { from: "agent", text: "📧 تم إرسال التقرير التفصيلي بصيغة PDF إلى بريدك الإلكتروني ✓", delay: 4400 },
    ],
  },
  {
    id: 4,
    label: "تسجيل دفعة",
    icon: "💳",
    messages: [
      { from: "user",  text: "سجّل دفعة واردة من شركة الأمل بقيمة 12,000 ريال تحويل بنكي", delay: 0 },
      { from: "agent", text: "⏳ جاري البحث عن الفواتير المستحقة لشركة الأمل...", delay: 900 },
      { from: "agent", text: "🔍 وجدت فاتورتين مستحقتين:\n• SINV-2026-0035 — 8,000 ريال\n• SINV-2026-0038 — 4,000 ريال\n\nهل أوزّع الدفعة عليهما؟", delay: 2100 },
      { from: "user",  text: "نعم", delay: 3300 },
      { from: "agent", text: "✅ تم تسجيل الدفعة وتسوية الفاتورتين!\n\n💰 المبلغ: 12,000 ريال\n🏦 طريقة الدفع: تحويل بنكي\n📋 رقم سند القبض: RV-2026-0091\n\nرصيد شركة الأمل: 0 ريال (مسدّد بالكامل) ✓", delay: 4800 },
    ],
  },
  // ─── سيناريوهات تُظهر ما يميّزنا فعلاً، لا ما ننفّذه فحسب ───────────────────
  // الرفض المبرَّر أقوى دليل على الانضباط من نجاح مرتّب: العميل يرى الوكيل
  // يمتنع حين يجب أن يمتنع.
  {
    id: 5,
    label: "يرفض الناقص",
    icon: "🛡️",
    messages: [
      { from: "user",  text: "أصدر فاتورة لمؤسسة الرياض بـ 20,000 ريال", delay: 0 },
      { from: "agent", text: "⏳ جاري فحص بيانات العميل قبل الإصدار...", delay: 900 },
      { from: "agent", text: "⚠️ لا يمكنني إصدار فاتورة ضريبية لهذا العميل الآن.\n\nالناقص:\n• الرقم الضريبي للعميل\n• عنوان العميل (الشارع والمدينة)\n\nمتطلبات هيئة الزكاة والضريبة تُلزم بذكرهما. أرسل البيانات وأسجّلها ثم أُصدر الفاتورة.", delay: 2400 },
      { from: "user",  text: "الرقم 310123456789003 والعنوان طريق الملك فهد، الرياض", delay: 4000 },
      { from: "agent", text: "✅ سجّلت البيانات — صيغة الرقم سليمة.\n\n📌 للعلم: تحققي من الصيغة فقط؛ لا توجد واجهة رسمية للتحقق من تسجيله لدى الهيئة.\n\nالبيانات مكتملة الآن. أُصدر الفاتورة؟", delay: 5800 },
    ],
  },
  {
    id: 6,
    label: "يحترم الصلاحيات",
    icon: "🔒",
    messages: [
      { from: "user",  text: "سجّل قيد يومية: مدين مصروفات 5,000 دائن الصندوق 5,000", delay: 0 },
      { from: "agent", text: "⏳ جاري التحقق من صلاحياتك في نظامكم...", delay: 800 },
      { from: "agent", text: "🔒 حسابك لا يملك صلاحية إنشاء القيود اليومية، فلا أستطيع تنفيذ ذلك.\n\nصلاحياتك تشمل: الفواتير، سندات القبض، والتقارير.\n\nراجع مدير النظام عندكم لمنحك الصلاحية.", delay: 2200 },
      { from: "user",  text: "طيب اعرض لي فواتير هذا الشهر", delay: 3600 },
      { from: "agent", text: "✅ هذه ضمن صلاحياتك.\n\n📄 12 فاتورة بإجمالي 84,300 ريال\n💰 المحصّل: 61,200 ريال\n⏳ المستحق: 23,100 ريال", delay: 4900 },
    ],
  },
  {
    id: 7,
    label: "تقييم نظامك",
    icon: "🔍",
    messages: [
      { from: "user",  text: "قيّم نظامي وقل لي إيه الناقص قبل ما أستلمه من المورّد", delay: 0 },
      { from: "agent", text: "⏳ جاري فحص الإعدادات والحسابات ودورات العمل...", delay: 1000 },
      { from: "agent", text: "📋 تقرير التقييم — جاهز\n\n✅ فُحص وثبت\n• شجرة الحسابات مكتملة (128 حساب)\n• قالب الضريبة 15% مضبوط\n\n⚠️ نواقص\n• الرقم الضريبي للشركة غير مسجّل\n• لا توجد دورة موافقة على المشتريات\n• 34 عميلاً بلا عنوان — فواتيرهم لن تكون مستوفية\n\n❓ يحتاج قرارك\n• هل التسليم يشمل تدريب الموظفين؟ (بند تعاقدي)\n\nالتقرير محفوظ في حسابك — مسوّدة لمراجعتك لا شهادة استلام.", delay: 3000 },
    ],
  },
  {
    id: 8,
    label: "دورة عمل ونموذج",
    icon: "⚙️",
    messages: [
      { from: "user",  text: "عايز أي فاتورة فوق 50 ألف تعدي على المدير المالي، وعايز نموذج طباعة بشعارنا", delay: 0 },
      { from: "agent", text: "⏳ جاري قراءة الأدوار المتاحة في نظامك...", delay: 900 },
      { from: "agent", text: "⚙️ تصميم دورة العمل:\n\nمسودة ← بانتظار الاعتماد ← معتمدة\n• المحاسب: ينشئ ويرسل للاعتماد\n• المدير المالي: يعتمد أو يرفض\n\nوللنموذج أحتاج:\n• شعار الشركة (PNG عرض 800px+)\n• الخط: أقترح Cairo — واضح على الفواتير\n\nأوافق على التصميم وأنفّذه؟", delay: 2600 },
      { from: "user",  text: "موافق، والشعار مرفوع في النظام", delay: 4200 },
      { from: "agent", text: "✅ أُنشئت دورة العمل وفُعّلت.\n✅ أُنشئ نموذج الطباعة بخط Cairo وشعاركم كترويسة.\n\n📌 النموذج معطّل — عاينه من نظامك وفعّله بنفسك. هو ما سيراه عملاؤك.", delay: 6000 },
    ],
  },

];

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

const NAV_LINKS = [
  { label: "الخدمات", href: "#services" },
  { label: "كيف نعمل", href: "#how" },
  { label: "المحاكاة", href: "#demo" },
  { label: "الباقات", href: "#pricing" },
  { label: "تواصل معنا", href: "#contact" },
];

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  // أقسام الصفحة كانت تختفي كلياً على الجوال (`hidden md:flex`) بلا بديل، فمن
  // يفتح الصفحة من هاتفه لا سبيل له إلى الباقات إلا بتمرير الصفحة كاملة.
  const [menuOpen, setMenuOpen] = useState(false);
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);
  // الشريط شفّاف فوق الهيرو الكحلي حتى أول ٤٠ بكسل تمرير، فنصٌّ كحلي هنا يعني
  // كحلي على كحلي — تباين 1.00:1، أي زرٌّ غير مرئي تماماً في أول ما يراه
  // الزائر. اللون يتبع حالة الشريط لا يثبت. والقائمة المفتوحة سطحٌ أبيض كذلك.
  const onLight = scrolled || menuOpen;
  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${
      onLight ? "bg-background/85 backdrop-blur-xl border-b border-navy/10" : "bg-transparent border-b border-transparent"
    }`}>
      <div className="container flex items-center justify-between h-18 py-2">
        <a href="#top" className="flex items-center gap-3 shrink-0" onClick={() => setMenuOpen(false)}>
          <img src="/manus-storage/almoaser-icon-192_bc4dbf5e.png" alt="شعار المعاصر"
            className={`w-11 h-11 rounded-2xl p-1.5 object-contain bg-white transition-shadow ${
              onLight ? "border border-navy/10 shadow-sm" : "shadow-lg shadow-navy/40"
            }`} />
          <span className="leading-tight">
            <span className={`block font-bold text-lg ${onLight ? "text-navy" : "text-white"}`}>
              Almoaser <span className={`font-light text-sm ${onLight ? "text-gold-ink" : "text-gold"}`}>AI ERP</span>
            </span>
            <span className={`block text-xs ${onLight ? "text-muted-foreground" : "text-white/60"}`}>خدمات مسك الدفاتر</span>
          </span>
        </a>

        <div className={`hidden lg:flex items-center gap-1 rounded-full p-1 border ${
          onLight ? "bg-navy/[0.04] border-navy/10" : "bg-white/10 border-white/15"
        }`}>
          {NAV_LINKS.map(l => (
            <a key={l.href} href={l.href}
              className={`inline-flex items-center h-9 px-4 rounded-full text-sm font-medium transition-colors ${
                onLight ? "text-navy/70 hover:text-navy hover:bg-white" : "text-white/75 hover:text-white hover:bg-white/15"
              }`}>{l.label}</a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button onClick={() => navigate("/erp")} className="bg-gold text-navy hover:bg-gold-light font-semibold">
              لوحة التحكم
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => navigate("/login")}
                className={`hidden sm:inline-flex ${onLight ? "text-navy hover:bg-navy/5" : "text-white hover:bg-white/15"}`}>
                تسجيل الدخول
              </Button>
              <Button onClick={() => navigate("/signup")} className="bg-gold text-navy hover:bg-gold-light font-semibold">
                ابدأ مجاناً
              </Button>
            </>
          )}
          <button type="button" onClick={() => setMenuOpen(o => !o)}
            aria-label={menuOpen ? "إغلاق القائمة" : "فتح القائمة"} aria-expanded={menuOpen}
            className={`lg:hidden w-11 h-11 rounded-xl inline-flex items-center justify-center transition-colors ${
              onLight ? "text-navy hover:bg-navy/5" : "text-white hover:bg-white/15"
            }`}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="lg:hidden border-t border-navy/10 bg-background/95 backdrop-blur-xl animate-fade-in-up">
          <div className="container py-3 flex flex-col">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                className="flex items-center min-h-11 px-2 rounded-lg text-navy/80 hover:text-navy hover:bg-navy/5 transition-colors">
                {l.label}
              </a>
            ))}
            {!isAuthenticated && (
              <button type="button" onClick={() => { setMenuOpen(false); navigate("/login"); }}
                className="sm:hidden flex items-center min-h-11 px-2 rounded-lg text-navy/80 hover:text-navy hover:bg-navy/5 transition-colors text-start">
                تسجيل الدخول
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function HeroSection() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  return (
    <section id="top" className="bg-navy-hero min-h-screen flex items-center relative overflow-hidden pt-24 pb-16">
      <div className="absolute inset-0 m-hero-grid" aria-hidden />
      <div className="absolute -top-24 -left-24 w-[28rem] h-[28rem] rounded-full bg-gold/10 blur-3xl" aria-hidden />
      <div className="absolute -bottom-32 -right-20 w-[32rem] h-[32rem] rounded-full bg-white/5 blur-3xl" aria-hidden />
      <div className="container relative z-10">
        <div className="max-w-3xl">
          <div className="m-chip m-chip--on-dark mb-8 animate-fade-in-up">
            <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
            مكتب المحاسبة الذكي #1 في المملكة
          </div>
          <h1 className="text-[clamp(2.25rem,7vw,4rem)] font-bold text-white leading-[1.15] tracking-tight mb-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            محاسبون محترفون<br />
            <span className="text-gold">يمسكون دفاترك</span><br />
            بمساعدة النظام الذكي
          </h1>
          <p className="text-white/70 text-lg md:text-xl leading-relaxed mb-10 max-w-2xl animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            فريق محاسبي محترف يدعمه نظام ذكي يعمل 24/7 — يُدخل الفواتير، يُسجّل القيود، ويُنتج التقارير برسالة واحدة عبر تليجرام أو من الموقع مباشرة.
          </p>
          <div className="flex flex-wrap gap-3 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            {isAuthenticated ? (
              <Button size="lg" onClick={() => navigate("/erp")}
                className="bg-gold text-navy hover:bg-gold-light text-base px-7 h-13 font-semibold shadow-lg shadow-navy/40">
                الذهاب للوحة التحكم
                <ArrowLeft className="w-5 h-5" />
              </Button>
            ) : (
              <Button size="lg" onClick={() => navigate("/signup")}
                className="bg-gold text-navy hover:bg-gold-light text-base px-7 h-13 font-semibold shadow-lg shadow-navy/40">
                ابدأ تجربتك المجانية
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}
            {/* العائد لا يبحث عن "ابدأ مجاناً" — يبحث عن الدخول. وجوده هنا يوفّر
                عليه التمرير لأعلى الصفحة في كل زيارة. */}
            {!isAuthenticated && (
              <Button size="lg" variant="outline"
                className="border-white/25 text-white bg-white/10 hover:bg-white/20 text-base px-7 h-13"
                onClick={() => navigate("/login")}>
                تسجيل الدخول
              </Button>
            )}
            <Button size="lg" variant="ghost"
              className="text-white/85 hover:text-white hover:bg-white/10 text-base px-7 h-13"
              onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}>
              عرض الباقات
            </Button>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-6 mt-14 pt-8 border-t border-white/10 animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            {[
              { value: "+200", label: "عميل نشط" },
              { value: "24/7", label: "وقت العمل" },
              { value: "90%", label: "توفير في الوقت" },
              { value: "5 ثوانٍ", label: "لإنشاء فاتورة" },
            ].map((s, i) => (
              <div key={i}>
                <dt className="sr-only">{s.label}</dt>
                <dd>
                  <span className="block text-3xl font-bold text-gold tracking-tight">{s.value}</span>
                  <span className="block text-white/55 text-sm mt-1">{s.label}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <a href="#services" aria-label="انتقل إلى الخدمات"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors animate-bounce">
        <span className="text-xs">اسحب للأسفل</span>
        <ChevronDown className="w-4 h-4" />
      </a>
    </section>
  );
}

function ServicesSection() {
  const { ref, inView } = useInView();
  // اللون هنا كان زينة: أخضرُ للفواتير وأصفرُ للقيود وأحمرُ للرواتب بلا معنى
  // يجمعها — ستّ بطاقات بأربعة ألوان تجعل العين تقرأ العنوان في كل مرة لأن
  // اللون لا يدلّ على شيء. أيقونةٌ واحدة بلون واحد، والتمييز بالاسم.
  const services = [
    { icon: <BookOpen className="w-5 h-5" />, title: "مسك الدفاتر", desc: "محاسبون محترفون يسجّلون عملياتك المالية اليومية بدقة، يدعمهم نظام ذكي متخصص." },
    { icon: <FileText className="w-5 h-5" />, title: "إدارة الفواتير", desc: "إنشاء واعتماد فواتير المبيعات والمشتريات فوراً برسالة عبر تليجرام أو من الموقع." },
    { icon: <DollarSign className="w-5 h-5" />, title: "القيود المحاسبية", desc: "تسجيل القيود اليومية والتسويات بدقة مع مراجعة محاسبية فورية." },
    { icon: <BarChart3 className="w-5 h-5" />, title: "التقارير المالية", desc: "ميزانية، قائمة دخل، تقرير الذمم — جاهزة في ثوانٍ بأمر نصي." },
    { icon: <Users className="w-5 h-5" />, title: "إدارة الرواتب", desc: "حساب الرواتب والمستحقات وإنشاء قيودها المحاسبية تلقائياً." },
    { icon: <Shield className="w-5 h-5" />, title: "الامتثال الضريبي", desc: "احتساب ضريبة القيمة المضافة وإعداد الإقرارات الضريبية الدورية." },
  ];
  return (
    <section id="services" className="py-20 md:py-24 m-band scroll-mt-20" ref={ref}>
      <div className="container">
        <div className={`m-section-head mb-14 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="m-chip mb-5"><Zap className="w-4 h-4" />خدماتنا</div>
          <h2 className="m-h2 mb-4">كل ما تحتاجه لإدارة محاسبتك</h2>
          <p className="m-sub">محاسبون متخصصون لكل قسم، يعملون بتناسق تام مع نظام Almoaser AI ERP الخاص بك.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((s, i) => (
            <div key={i} className={`m-card ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.06}s` }}>
              <div className="m-icon mb-4">{s.icon}</div>
              <h3 className="font-bold text-lg text-navy mb-2">{s.title}</h3>
              <p className="m-sub text-sm">{s.desc}</p>
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
    { num: "01", title: "سجّل حسابك", desc: "أنشئ حسابك في دقيقة واحدة — بياناتك الأساسية فقط، دون مقابلات أو أوراق.", icon: <Users className="w-5 h-5" /> },
    { num: "02", title: "اختر باقتك وابدأ التجربة", desc: "اختر الباقة المناسبة لحجم أعمالك وابدأ تجربة مجانية 3 أيام كاملة المزايا، دون دفع مسبق.", icon: <Star className="w-5 h-5" /> },
    { num: "03", title: "اربط نظامك المحاسبي", desc: "يتصل حسابك بنظام المعاصر ERP تلقائياً، ويحصل حسابك على رصيد نقاطك الشهري فوراً.", icon: <Bot className="w-5 h-5" /> },
    { num: "04", title: "تحدّث ونفّذ فوراً", desc: "اكتب طلبك بالعربية — فاتورة، قيد، سند، تقرير — والنظام الذكي ينفذه بإشراف محاسبينا خلال ثوانٍ.", icon: <MessageCircle className="w-5 h-5" /> },
  ];
  return (
    <section id="how" className="py-20 md:py-24 scroll-mt-20" ref={ref}>
      <div className="container">
        <div className={`m-section-head mb-14 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="m-chip m-chip--accent mb-5"><Clock className="w-4 h-4" />كيف نعمل</div>
          <h2 className="m-h2 mb-4">أربع خطوات وتبدأ فوراً</h2>
          <p className="m-sub">تفعيل ذاتي بالكامل — من التسجيل حتى أول فاتورة ينفذها النظام الذكي في أقل من 10 دقائق.</p>
        </div>
        {/* الخطوات مرقّمة، والخيط الواصل بينها يقول إنها تسلسلٌ لا أربع بطاقات
            متجاورة. يختفي على الجوال حيث تتراصّ عمودياً فيصبح الخيط مضلِّلاً. */}
        <ol className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
          <div className="hidden lg:block absolute top-10 inset-x-12 h-px bg-navy/10" aria-hidden />
          {steps.map((s, i) => (
            <li key={i} className={`m-card relative ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.06}s` }}>
              <div className="m-icon m-icon--accent mb-4">{s.icon}</div>
              <p className="m-eyebrow tabular-nums">الخطوة {s.num}</p>
              <h3 className="font-bold text-navy mb-2">{s.title}</h3>
              <p className="m-sub text-sm">{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
// ─── قسم المحاكاة التفاعلية لتليجرام ───────────────────────────────────────
function TelegramDemoSection() {
  const { ref, inView } = useInView();
  const [activeScenario, setActiveScenario] = useState(0);
  const [visibleMessages, setVisibleMessages] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scenario = SCENARIOS[activeScenario];

  const playScenario = () => {
    setVisibleMessages(0);
    setIsPlaying(true);
    scenario.messages.forEach((msg, i) => {
      const t = setTimeout(() => {
        setVisibleMessages(i + 1);
        if (i === scenario.messages.length - 1) setIsPlaying(false);
      }, msg.delay + 400);
      timerRef.current = t;
    });
  };

  const switchScenario = (idx: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveScenario(idx);
    setVisibleMessages(0);
    setIsPlaying(false);
  };

  // تشغيل تلقائي عند الدخول للعرض
  useEffect(() => {
    if (inView && visibleMessages === 0 && !isPlaying) {
      setTimeout(() => playScenario(), 600);
    }
  }, [inView]);

  return (
    <section id="demo" className="py-20 md:py-24 m-band scroll-mt-20" ref={ref}>
      <div className="container">
        {/* Header */}
        <div className={`m-section-head mb-14 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="m-chip mb-5"><MessageCircle className="w-4 h-4" />محاكاة حية</div>
          <h2 className="m-h2 mb-4">
            شاهد النظام الذكي <span className="text-gold-ink">يعمل الآن</span>
          </h2>
          <p className="m-sub">
            أرسل أمراً بالعربية عبر تليجرام أو من الموقع مباشرة — النظام يفهمه وينفذه في نظامك المحاسبي خلال ثوانٍ.
          </p>
        </div>

        <div className={`grid lg:grid-cols-2 gap-10 lg:gap-12 items-center ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.15s" }}>
          {/* يسار: اختيار السيناريو + شرح */}
          <div className="space-y-5">
            <p className="m-eyebrow">اختر سيناريو لمشاهدته</p>
            <div className="grid grid-cols-2 gap-2.5">
              {SCENARIOS.map((s, i) => (
                <button key={s.id} onClick={() => { switchScenario(i); setTimeout(() => playScenario(), 100); }}
                  aria-pressed={activeScenario === i}
                  className={`flex items-center gap-3 min-h-14 px-4 py-3 rounded-xl border text-start transition-colors duration-200 ${
                    activeScenario === i
                      ? "border-gold bg-gold text-navy font-bold"
                      : "border-navy/10 bg-card text-navy hover:border-navy/25 hover:bg-navy/[0.03]"
                  }`}>
                  <span className="text-xl leading-none" aria-hidden>{s.icon}</span>
                  <span className="font-semibold text-sm leading-snug">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* يمين: هاتف تليجرام */}
          <div className="flex justify-center">
            <div className="relative w-[320px]">
              {/* ui-agent:mockup-start — رسمٌ مصغّر لهاتف: النصّ فيه صغير عمداً
                   لأنه صورة لواجهة، لا واجهة. فحص أحجام الخطّ يتخطّاه. */}
              {/* إطار الهاتف */}
              <div className="bg-[#17212b] rounded-[2.5rem] p-3 shadow-2xl border-4 border-gray-800">
                {/* شريط الحالة */}
                <div className="bg-[#17212b] rounded-t-[2rem] px-4 pt-2 pb-1 flex items-center justify-between">
                  <span className="text-white/50 text-[10px]">9:41</span>
                  <div className="flex gap-1">
                    <div className="w-3 h-1.5 bg-white/40 rounded-sm" />
                    <div className="w-1 h-1.5 bg-white/40 rounded-sm" />
                  </div>
                </div>
                {/* رأس المحادثة */}
                <div className="bg-[#242f3d] px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#12719e] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">AI</div>
                  <div>
                    <p className="text-white font-semibold text-sm">Almoaser Bot</p>
                    <p className="text-[#5eb5f7] text-xs flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#5eb5f7] inline-block animate-pulse" />
                      متصل الآن
                    </p>
                  </div>
                </div>
                {/* منطقة الرسائل */}
                <div className="bg-[#0e1621] rounded-b-[2rem] px-3 py-4 min-h-[380px] max-h-[380px] overflow-y-auto space-y-3 flex flex-col">
                  {/* خلفية نمط تليجرام */}
                  <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
                  }} />

                  {scenario.messages.slice(0, visibleMessages).map((msg, i) => (
                    <div key={`${activeScenario}-${i}`}
                      className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"} animate-fade-in-up`}>
                      {msg.type === "pdf" ? (
                        /* ─── بطاقة PDF ─── */
                        <div className="max-w-[88%] bg-[#182533] rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
                          <p className="text-[#5eb5f7] text-[10px] font-semibold px-3 pt-2">Almoaser Bot ✓</p>
                          {/* معاينة PDF */}
                          <div className="mx-3 my-2 bg-[#0e1621] rounded-xl overflow-hidden border border-white/10">
                            {/* شريط PDF أحمر */}
                            <div className="bg-red-600 px-3 py-2 flex items-center gap-2">
                              <div className="bg-white/20 rounded px-1.5 py-0.5 text-white text-[9px] font-bold tracking-wider">PDF</div>
                              <span className="text-white text-[10px] font-medium truncate flex-1">{msg.pdfName}</span>
                            </div>
                            {/* معاينة مصغرة للفاتورة */}
                            <div className="bg-white p-2 text-[7px] leading-relaxed text-gray-700 font-mono" dir="rtl">
                              <div className="flex justify-between items-start mb-1">
                                <div>
                                  <p className="font-bold text-[8px] text-navy">Almoaser AI ERP</p>
                                  <p className="text-gray-400">فاتورة ضريبية</p>
                                </div>
                                <div className="text-left">
                                  <p className="font-bold text-red-600">SINV-2026-0042</p>
                                  <p className="text-gray-400">2026-07-17</p>
                                </div>
                              </div>
                              <div className="border-t border-gray-200 pt-1 mt-1">
                                <div className="flex justify-between"><span>شركة النور للتجارة</span><span className="font-bold">5,000 ر.س</span></div>
                                <div className="flex justify-between text-gray-400"><span>خدمات استشارية</span><span>+ 750 ضريبة</span></div>
                              </div>
                              <div className="border-t border-gray-200 pt-1 mt-1 flex justify-between font-bold text-[8px]">
                                <span>الإجمالي شامل الضريبة</span><span className="text-green-700">5,750 ر.س</span>
                              </div>
                            </div>
                            {/* شريط أسفل */}
                            <div className="bg-[#242f3d] px-3 py-1.5 flex items-center justify-between">
                              <span className="text-gray-400 text-[9px]">{msg.pdfSize}</span>
                              <span className="text-blue-400 text-[9px] font-medium">اضغط للفتح ↓</span>
                            </div>
                          </div>
                          <p className="text-gray-100 text-xs px-3 pb-1">{msg.text}</p>
                          <p className="text-[9px] text-gray-500 px-3 pb-2 text-left">
                            {new Date().toLocaleTimeString("ar-SA-u-ca-gregory", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      ) : (
                        /* ─── رسالة نصية عادية ─── */
                        <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow-sm ${
                          msg.from === "user"
                            ? "bg-[#2b5278] text-white rounded-tr-sm"
                            : "bg-[#182533] text-gray-100 rounded-tl-sm"
                        }`}>
                          {msg.from === "agent" && (
                            <p className="text-[#5eb5f7] text-[10px] font-semibold mb-1">Almoaser Bot ✓</p>
                          )}
                          {msg.text}
                          <p className={`text-[9px] mt-1 text-left ${msg.from === "user" ? "text-white/50" : "text-gray-500"}`}>
                            {new Date().toLocaleTimeString("ar-SA-u-ca-gregory", { hour: "2-digit", minute: "2-digit" })}
                            {msg.from === "user" && " ✓✓"}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* مؤشر الكتابة */}
                  {isPlaying && visibleMessages < scenario.messages.length && (
                    <div className="flex justify-start animate-fade-in-up">
                      <div className="bg-[#182533] px-4 py-3 rounded-2xl rounded-tl-sm">
                        <div className="flex gap-1 items-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* ui-agent:mockup-end */}

              {/* زر إعادة التشغيل */}
              <button onClick={playScenario} disabled={isPlaying}
                className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-2 px-5 h-11 rounded-full bg-card border border-navy/10 shadow-lg shadow-navy/10 text-navy text-xs font-semibold hover:border-navy/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {isPlaying ? (
                  <><span className="w-3 h-3 rounded-full border-2 border-navy border-t-transparent animate-spin" />جاري التنفيذ...</>
                ) : (
                  <><Zap className="w-3.5 h-3.5 text-gold-ink" />إعادة التشغيل</>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* القيمة المضافة — تحت معاينة عمل الوكيل */}
        <div className={`mt-20 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.3s" }}>
          <h3 className="m-h2 text-center mb-8">لماذا هذا يغيّر كل شيء؟</h3>
          {/* كانت الرموز التعبيرية (⚡🎯🌙💬) ترسمها كل منصّة بشكلها وحجمها،
              فيختلف الصفّ عن كل أيقونات المنتج. أيقونات lucide نفسها المستعملة
              في بقية الشاشات. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: <Gauge className="w-5 h-5" />, title: "سرعة فائقة", desc: "ما كان يستغرق 15 دقيقة يتم في 5 ثوانٍ" },
              { icon: <Target className="w-5 h-5" />, title: "دقة 100%", desc: "لا أخطاء إدخال يدوي، البيانات تُسجَّل مباشرة" },
              { icon: <Moon className="w-5 h-5" />, title: "24/7 بلا توقف", desc: "النظام يعمل حتى في العطل والإجازات" },
              { icon: <Languages className="w-5 h-5" />, title: "بالعربية الفصحى والعامية", desc: "يفهم طلبك بأي أسلوب تكتب به" },
            ].map((v, i) => (
              <div key={i} className="m-card">
                <div className="m-icon mb-4">{v.icon}</div>
                <p className="font-bold text-navy mb-1">{v.title}</p>
                <p className="m-sub text-sm">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// الأقسام تتناوب: مسحة كحلية (`m-band`) ثم خلفية عادية، فيُقرأ الفاصل بينها بلا
// خطوط. والباقات على العادية لأن ما قبلها (الالتزام الضريبي) بمسحة.
function PricingSection({ onSelectPlan }: { onSelectPlan: (planId: number) => void }) {
  const { ref, inView } = useInView();
  const [, navigate] = useLocation();
  const { data: plans, isLoading } = trpc.plans.list.useQuery();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  const planIcons = [<BookOpen className="w-5 h-5" />, <Zap className="w-5 h-5" />, <Bot className="w-5 h-5" />];
  const planBadges = ["", "الأكثر طلباً", ""];

  return (
    <section id="pricing" className="py-20 md:py-24 scroll-mt-20" ref={ref}>
      <div className="container">
        <div className={`m-section-head mb-14 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="m-chip mb-5"><DollarSign className="w-4 h-4" />الباقات والأسعار</div>
          <h2 className="m-h2 mb-4">باقات تناسب جميع الأعمال</h2>
          <p className="m-sub">أسعار بدون رسوم خفية — جميع الباقات تشمل الربط مع نظام المعاصر ERP ورصيد نقاط شهرياً. يمكنك الترقية أو الإلغاء في أي وقت.</p>
          <p className="text-xs text-muted-foreground mt-2">الأسعار لا تشمل ضريبة القيمة المضافة (15%)</p>
          {/* مبدّل الفوترة الشهرية/السنوية */}
          <div className="inline-flex items-center gap-1 mt-7 p-1 rounded-full bg-card border border-navy/10">
            <button
              onClick={() => setBilling("monthly")}
              aria-pressed={billing === "monthly"}
              className={`px-5 min-h-11 rounded-full text-sm font-semibold transition-colors ${billing === "monthly" ? "bg-navy text-white" : "text-muted-foreground hover:text-navy"}`}
            >
              شهري
            </button>
            <button
              onClick={() => setBilling("yearly")}
              aria-pressed={billing === "yearly"}
              className={`px-5 min-h-11 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 ${billing === "yearly" ? "bg-navy text-white" : "text-muted-foreground hover:text-navy"}`}
            >
              سنوي
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${billing === "yearly" ? "bg-gold text-navy" : "bg-gold/15 text-gold-ink"}`}>خصم 15%</span>
            </button>
          </div>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          /* البطاقة الوسطى كانت `scale-105` فتخرج عن صفّ الحواف وتختلف
             ارتفاعاتها عن جارتيها، و`items-center` يجعل الثلاث تتفاوت رأسياً.
             التمييز الآن بحلقةٍ وشارة — والهندسة واحدة. */
          <div className="grid md:grid-cols-3 gap-5 items-stretch">
            {plans?.map((plan, i) => {
              const isPopular = i === 1;
              const monthly = Number(plan.price);
              const discountPct = plan.yearlyDiscountPct ?? 15;
              const yearlyTotal = Math.round(monthly * 12 * (1 - discountPct / 100));
              const yearlyPerMonth = Math.round(yearlyTotal / 12);
              return (
                <div key={plan.id}
                  className={`m-card flex flex-col p-7 relative ${isPopular ? "ring-2 ring-navy border-navy/20" : ""} ${inView ? "animate-fade-in-up" : "opacity-0"}`}
                  style={{ animationDelay: `${i * 0.1}s` }}>
                  {planBadges[i] && (
                    <div className="absolute -top-3 right-1/2 translate-x-1/2 bg-navy text-white text-xs font-bold px-4 py-1.5 rounded-full whitespace-nowrap">
                      {planBadges[i]}
                    </div>
                  )}
                  <div className={`m-icon mb-4 ${isPopular ? "bg-navy text-gold" : ""}`}>
                    {planIcons[i]}
                  </div>
                  <h3 className="text-xl font-bold text-navy mb-2">{plan.nameAr}</h3>
                  {billing === "monthly" ? (
                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className="text-4xl font-bold text-navy tracking-tight">{monthly.toLocaleString("ar-SA")}</span>
                      <span className="text-muted-foreground text-sm">ريال / شهر</span>
                    </div>
                  ) : (
                    <div className="mb-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-4xl font-bold text-navy tracking-tight">{yearlyPerMonth.toLocaleString("ar-SA")}</span>
                        <span className="text-muted-foreground text-sm">ريال / شهر</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        <span className="line-through">{(monthly * 12).toLocaleString("ar-SA")}</span>
                        <span className="text-gold-ink font-bold"> {yearlyTotal.toLocaleString("ar-SA")} ريال سنوياً</span>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mb-6 text-xs font-medium">
                    <span className="px-2.5 py-1 rounded-full bg-navy/5 text-navy">{planCapacityLabel(plan)}</span>
                    <span className="px-2.5 py-1 rounded-full bg-gold/15 text-gold-ink">{plan.monthlyCredits ?? 150} نقطة / شهر</span>
                  </div>
                  {/* كل المزايا في كل بطاقة: المتاح بعلامة صح والمستبعد بعلامة
                      إكس. عرض المتاح وحده يُخفي الفرق بين الباقات، وهو تحديداً
                      ما يحتاجه الزائر ليقرر الترقية.
                      و`m-featurelist` تُبقيها محاذاة للبداية على الجوال: سطرٌ
                      يبدأ بعلامة، وتوسيطه يُبعثر العلامات. */}
                  <ul className="m-featurelist space-y-2.5 mb-7 pt-5 border-t border-navy/10 w-full">
                    {featuresForCard(plan.id).map(f => {
                      const has = f.includedIn.includes(plan.id);
                      return (
                        <li key={f.key} className={`flex items-start gap-2 text-sm ${has ? "" : "opacity-45"}`}>
                          {has
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden />
                            : <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden />}
                          <span className={has ? "text-foreground" : "text-muted-foreground line-through"}>
                            {f.label}
                          </span>
                          <span className="sr-only">{has ? "متاح" : "غير متاح"}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {/* الزر كان يقول "اطلب استشارة" ويُنزل لفورم التواصل، فلا يصل أحد
                      إلى التسجيل من هنا. الآن يبدأ التجربة مباشرة والباقة محمولة معه. */}
                  <Button
                    className={`w-full h-12 mt-auto font-semibold ${isPopular ? "bg-navy text-white hover:bg-navy-light" : "border-navy/25 text-navy hover:bg-navy hover:text-white"}`}
                    variant={isPopular ? "default" : "outline"}
                    onClick={() => {
                      onSelectPlan(plan.id);
                      navigate(`/signup?plan=${plan.id}`);
                    }}
                  >
                    ابدأ التجربة المجانية — 3 أيام
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPlan(plan.id);
                      document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="w-full mt-2 text-xs text-muted-foreground hover:text-navy transition-colors [@media(pointer:coarse)]:min-h-11"
                  >
                    أو تحدّث مع مستشار أولاً
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ContactSection({ initialPlanId }: { initialPlanId: number | null }) {
  const { ref, inView } = useInView();
  const [, navigate] = useLocation();
  const { data: plans } = trpc.plans.list.useQuery();
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");

  const [form, setForm] = useState({ name: "", email: "", phone: "", companyName: "", companyType: "", businessSector: "", planId: "", message: "" });

  // الباقة المختارة من بطاقات الأسعار تُملأ تلقائياً في الفورم
  useEffect(() => {
    if (initialPlanId != null) setForm(f => ({ ...f, planId: String(initialPlanId) }));
  }, [initialPlanId]);

  // لا عدّاد ولا إعادة توجيه تلقائية: كانت تُرجع العميل لقسم الباقات حيث الزر
  // يُنزله للفورم من جديد — حلقة لا مخرج منها. الآن الخطوة التالية زر صريح.

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
    <section id="contact" className="py-20 md:py-24 bg-navy-hero relative overflow-hidden scroll-mt-20" ref={ref}>
      <div className="absolute inset-0 m-hero-grid" aria-hidden />
      <div className="container relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className={`${inView ? "animate-fade-in-up" : "opacity-0"}`}>
            <div className="m-chip m-chip--on-dark mb-6">
              <MessageCircle className="w-4 h-4" />
              تواصل معنا
            </div>
            <h2 className="m-h2 text-white mb-5">ابدأ رحلتك مع <span className="text-gold">Almoaser AI</span> اليوم</h2>
            <p className="text-white/70 text-lg leading-relaxed mb-8">
              سجّل بياناتك ونتواصل معك لنساعدك على اختيار الباقة المناسبة لعملك — أو ابدأ التجربة المجانية مباشرة الآن.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {[
                { icon: <Phone className="w-5 h-5" />, text: "+966 56 467 7377", href: "tel:+966564677377" },
                { icon: <Mail className="w-5 h-5" />, text: "info@almoaser.com", href: "mailto:info@almoaser.com" },
                { icon: <Send className="w-5 h-5" />, text: "تليجرام متاح 24/7", href: "https://t.me/AlmoaserBot" },
                { icon: <MessageCircle className="w-5 h-5" />, text: "واتساب متاح 24/7", href: "https://wa.me/966564677377" },
              ].map((c, i) => (
                <a key={i} href={c.href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 min-h-14 px-3 rounded-xl border border-white/10 bg-white/[0.04] text-white/80 hover:text-white hover:bg-white/10 hover:border-white/25 transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-white/10 group-hover:bg-gold group-hover:text-navy text-gold flex items-center justify-center transition-colors shrink-0">{c.icon}</div>
                  <span className="text-sm">{c.text}</span>
                </a>
              ))}
            </div>
          </div>
          <div className={`bg-card rounded-3xl p-6 sm:p-8 shadow-2xl shadow-navy/40 ${inView ? "animate-slide-in-right" : "opacity-0"}`}>
            {submitted ? (
              /* ─── رسالة الترحيب المتحركة ─── */
              <div className="flex flex-col items-center justify-center text-center py-6 animate-fade-in-up">
                {/* دائرة النجاح المتحركة */}
                <div className="relative mb-6">
                  <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center animate-[bounce_0.6s_ease-out]">
                    <CheckCircle2 className="w-10 h-10 text-emerald-600" strokeWidth={1.5} />
                  </div>
                  <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-gold flex items-center justify-center">
                    <Star className="w-4 h-4 text-navy" fill="currentColor" />
                  </div>
                </div>
                {/* نص الترحيب */}
                <h3 className="text-2xl font-bold text-navy mb-2">
                  {/* `text-gold` على أبيض تباينه 2.4:1 ولا يُقرأ — `text-gold-ink` وُضع لهذا */}
                  أهلاً وسهلاً، <span className="text-gold-ink">{submittedName}</span>! 🎉
                </h3>
                <p className="m-sub text-sm mb-6 max-w-xs">
                  تم استلام بياناتك بنجاح. سيتواصل معك فريق <strong>Almoaser AI</strong> خلال <strong>24 ساعة</strong>.
                </p>
                {/* بطاقات الخطوات التالية — لونٌ واحد: هذه خطوات لا حالات */}
                <div className="w-full space-y-2 mb-5">
                  {[
                    { icon: <Phone className="w-4 h-4" />, text: "سيتصل بك مستشارنا قريباً" },
                    { icon: <MessageCircle className="w-4 h-4" />, text: "أو تواصل معنا عبر واتساب الآن" },
                    { icon: <CheckCircle2 className="w-4 h-4" />, text: "أو ابدأ تجربتك المجانية فوراً دون انتظار" },
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-3 min-h-12 px-3 rounded-xl bg-navy/[0.04] text-navy animate-fade-in-up"
                      style={{ animationDelay: `${0.2 + i * 0.15}s` }}>
                      <div className="flex-shrink-0 text-gold-ink">{step.icon}</div>
                      <span className="text-sm font-medium text-start">{step.text}</span>
                    </div>
                  ))}
                </div>
                {/* أزرار الإجراء */}
                <div className="flex flex-col sm:flex-row gap-2 w-full">
                  <a href="https://wa.me/966564677377?text=مرحباً، أريد الاستفسار عن خدمات Almoaser AI"
                    target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="outline" className="w-full h-12 border-navy/25 text-navy hover:bg-navy hover:text-white gap-2">
                      <MessageCircle className="w-4 h-4" />
                      واتساب الآن
                    </Button>
                  </a>
                  <Button
                    className="flex-1 h-12 bg-navy text-white gap-2 hover:bg-navy-light font-semibold"
                    onClick={() => navigate(form.planId ? `/signup?plan=${form.planId}` : "/signup")}
                  >
                    <Sparkles className="w-4 h-4" />
                    ابدأ التجربة المجانية
                  </Button>
                </div>
              </div>
            ) : (
              /* ─── النموذج ─── */
              <>
                <h3 className="text-xl font-bold text-navy mb-6">سجّل لنتواصل معك</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
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
                        <p className="text-xs text-muted-foreground mt-1">الصيغ المقبولة: 0512345678 أو +966512345678</p>
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
                  <div className="grid sm:grid-cols-2 gap-4">
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
                    <p className="text-xs text-muted-foreground mt-1">اختياري — يساعدنا في تخصيص الخدمة لنشاطك</p>
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
                      className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none" />
                  </div>
                  <Button type="submit" disabled={submitMutation.isPending} className="w-full bg-navy text-white hover:bg-navy-light h-12 text-base font-semibold">
                    {submitMutation.isPending ? (
                      <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />جاري الإرسال...</span>
                    ) : (
                      <span className="flex items-center gap-2"><ArrowLeft className="w-4 h-4" />سجّل لنتواصل معك</span>
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
    <footer className="bg-navy-dark pt-14 pb-8 text-white/60">
      <div className="container">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr] md:items-start">
          <div className="flex items-center gap-3">
            <img src="/manus-storage/almoaser-icon-192_bc4dbf5e.png" alt="شعار المعاصر"
              className="w-11 h-11 rounded-2xl p-1.5 object-contain bg-white shrink-0" />
            <div>
              <div className="font-bold text-white text-lg leading-tight">
                Almoaser <span className="text-gold text-sm font-light">AI ERP</span>
              </div>
              <div className="text-sm">خدمات مسك الدفاتر بالذكاء الاصطناعي</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-1 text-sm md:justify-end" aria-label="روابط التذييل">
            {[
              { label: "الخدمات", href: "#services" },
              { label: "الباقات", href: "#pricing" },
              { label: "تواصل معنا", href: "#contact" },
              { label: "الموقع الرئيسي", href: "https://almoaser.com" },
            ].map(l => (
              <a key={l.href} href={l.href}
                {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-flex items-center min-h-11 hover:text-white transition-colors">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="mt-8 pt-6 border-t border-white/10 text-sm text-center md:text-start">
          © 2026 Almoaser AI ERP — جميع الحقوق محفوظة
        </div>
      </div>
    </footer>
  );
}


// ─── ما يميّزنا ───────────────────────────────────────────────────────────────
// تحت العرض الحيّ مباشرة: الزائر رأى الوكيل يعمل، وهنا يعرف لماذا يُؤتمن عليه.
// كل بند هنا مبنيّ فعلاً في المنصة — لا يُضاف بند لا يقابله سلوك في الكود.
function WhyUsSection() {
  const points = [
    {
      icon: <ShieldCheck className="w-5 h-5" />,
      title: "لا يخترع رقماً",
      body: "لا يذكر بياناً لم يقرأه من نظامك، وينقل الأرقام كما وردت بلا إعادة حساب. وإن فشلت عملية أخبرك بنص الخطأ بدل أن يقول \"تمّت\". في المحاسبة رقم مختلَق يعني قراراً مالياً خاطئاً.",
    },
    {
      icon: <Lock className="w-5 h-5" />,
      title: "لا يتجاوز صلاحياتك",
      body: "يقرأ صلاحيات المستخدم من نظام ERP نفسه، ولا يعرض عليه إلا ما يملكه فعلاً هناك. من لا يملك إنشاء قيد يومية في نظامه لا يستطيع ذلك عبرنا — ونظامك يبقى الحاجز الأخير.",
    },
    {
      icon: <CheckCircle2 className="w-5 h-5" />,
      title: "لا يُرحّل دون إذنك",
      body: "ينشئ المستند كمسودة، يعرضها عليك، ويطلب موافقتك الصريحة قبل الترحيل موضّحاً أنه يقيّد في الحسابات ولا يُلغى إلا بقيد عكسي.",
    },
    {
      icon: <FileText className="w-5 h-5" />,
      title: "يمنع الفاتورة غير المستوفية",
      body: "لا يُصدر فاتورة ضريبية لمنشأة قبل اكتمال بيانات المشتري ولا بلا إعداد ضريبي سليم — يطلب الناقص ويسجّله، بدل أن تُكتشف الفاتورة ناقصة عند الفحص.",
    },
    {
      icon: <Shield className="w-5 h-5" />,
      title: "صادق في حدود تحققه",
      body: "يتحقق من صيغة الرقم الضريبي ويقول ذلك صراحةً — ولا يدّعي أنه تحقق منه لدى هيئة الزكاة والضريبة، لأن الهيئة لا توفّر واجهة لذلك أصلاً.",
    },
    {
      icon: <BookOpen className="w-5 h-5" />,
      title: "خبرة محاسبية لا واجهة محادثة",
      body: "يعرف دورة حياة المستند والقيد المزدوج ومعايير IFRS ومتطلبات الفوترة الإلكترونية السعودية — ويتعامل مع ERPNext وOdoo معاً.",
    },
  ];
  return (
    <section className="py-20 md:py-24">
      <div className="container">
        <div className="m-section-head mb-14">
          <p className="m-eyebrow">لماذا نحن</p>
          <h2 className="m-h2">
            الانضباط قبل <span className="text-gold-ink">الذكاء</span>
          </h2>
          <p className="m-sub mt-4">
            أدوات كثيرة تُجيب بثقة حتى حين تكون مخطئة. في حساباتك، الامتناع في محلّه أثمن من إجابة سريعة.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {points.map((p, i) => (
            <div key={i} className="m-card">
              <div className="m-icon bg-navy text-gold mb-4">{p.icon}</div>
              <h3 className="font-bold text-navy mb-2">{p.title}</h3>
              <p className="m-sub text-sm">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}


// ─── الالتزام الضريبي ─────────────────────────────────────────────────────────
// قسم حسّاس قانونياً: ادّعاء التزام أوسع من الواقع أخطر من عدم ذكره. لذلك يذكر
// ما يفعله النظام فعلاً — وهو منع المستند غير المستوفي قبل صدوره — ويصرّح صراحةً
// بما لا يفعله ولا يدّعيه. الشفافية هنا ميزة بيع أمام محاسب ومراجع، لا اعتذار.
// ─── مخرجات باقة الخبير وأسعارها ──────────────────────────────────────────────
// تُعرض تحت الأسعار: العميل الذي يقرأ باقة الخبير يسأل مباشرة "وبكام التقييم؟".
// من نفس مصدر أسعار سارة، فلا يختلف ما يُقرأ عمّا يُقال.
function DeliverablesSection() {
  return (
    <section className="py-20 md:py-24">
      <div className="container">
        <div className="m-section-head mb-14">
          <p className="m-eyebrow">مخرجات الخبير</p>
          <h2 className="m-h2">
            تدفع مقابل ما <span className="text-gold-ink">تستلمه</span>
          </h2>
          <p className="m-sub mt-4">
            أسعار ثابتة لكل مخرَج، تُطلب فوق الاشتراك. لا تسعير بالساعة — تستلم عملاً محدداً بسعر تعرفه مقدماً.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {DELIVERABLES.map(d => (
            <div key={d.key} className="m-card flex flex-col">
              <h3 className="font-bold text-navy mb-1">{d.label}</h3>
              <p className="m-sub text-sm flex-1">{d.scope}</p>
              {/* السعر لا يُعلن هنا: نطاق المخرَج يختلف بحجم النظام وحالته،
                  ورقمٌ ثابت على الصفحة إمّا أن يخيف من هو أصغر من النطاق أو
                  يُقيّدنا مع من هو أكبر منه. يُحدَّد بعد فهم الحالة. */}
              <div className="mt-4 pt-3 border-t border-navy/10 w-full flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-navy">السعر حسب نطاق عملك</span>
                <span className="text-xs text-gold-ink font-semibold">اطلب عرضاً</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-8">
          الأسعار لا تشمل ضريبة القيمة المضافة (15%). المخرجات تُطلب من داخل حسابك بعد الاشتراك في باقة الخبير.
        </p>
      </div>
    </section>
  );
}

function ComplianceSection() {
  const enforced = [
    "لا تُصدَر فاتورة ضريبية لمنشأة قبل اكتمال الرقم الضريبي وعنوان المشتري — وهما مما تُلزم به الفاتورة الضريبية.",
    "لا تُنشأ فاتورة والإعداد الضريبي ناقص، فلا تخرج فاتورة بلا ضريبة دون أن ينتبه أحد.",
    "يُفحص الرقم الضريبي السعودي شكلياً وفق قاعدة الفوترة الإلكترونية: خمسة عشر رقماً تبدأ بـ 3 وتنتهي بـ 3.",
    "يُفرَّق بين الفاتورة المبسّطة للأفراد والفاتورة الضريبية للمنشآت، فلا تُطلب بيانات مشترٍ في غير موضعها.",
    "الضريبة تُحتسب على المبلغ بعد الخصم لا قبله، وتُفصل عن الإيراد في الحسابات لأنها أمانة تُورَّد لا دخل.",
  ];
  return (
    <section className="py-20 md:py-24 m-band">
      <div className="container">
        <div className="m-section-head mb-14">
          <p className="m-eyebrow">الالتزام الضريبي</p>
          <h2 className="m-h2">
            نمنع المستند الناقص <span className="text-gold-ink">قبل صدوره</span>
          </h2>
          <p className="m-sub mt-4">
            الفاتورة الخاطئة تُكتشف عند الفحص لا عند إصدارها. النظام يوقفها عند الإنشاء ويطلب الناقص.
          </p>
        </div>
        <div className="max-w-3xl mx-auto">
          <div className="m-card p-6 md:p-8">
            {/* الصفّ عموديٌّ دون 768 بكسل عمداً: `.m-icon` تأخذ `margin-inline: auto`
                على الجوال، وهي كعنصر flex تبتلع بها كلَّ الفراغ فتطفو الأيقونة في
                منتصف السطر ويرتطم العنوان بالحافّة. والحدّ `md` لا `sm` لأنه حدّ
                القاعدة نفسها (767px). */}
            <div className="flex flex-col md:flex-row items-center gap-3 mb-5">
              {/* الأخضر هنا حالة لا زينة: هذه القائمة هي ما يفرضه النظام فعلاً */}
              <span className="m-icon m-icon--ok"><ShieldCheck className="w-5 h-5" /></span>
              <h3 className="font-bold text-navy">ما يفرضه النظام</h3>
            </div>
            <ul className="m-featurelist space-y-3">
              {enforced.map((t, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm leading-7">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-1.5" aria-hidden />
                  <span className="text-foreground">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  // الباقة المختارة من بطاقات الأسعار — تُمرَّر لفورم التواصل ليُحدَّد بها تلقائياً
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <ServicesSection />
      <HowItWorksSection />
      <TelegramDemoSection />
      <WhyUsSection />
      <ComplianceSection />
      <PricingSection onSelectPlan={setSelectedPlanId} />
      {/* «تدفع مقابل ما تستلمه» — مخفيّ بطلب صاحب المنتج.
          يبقى المكوّن وبياناته في مكانهما ليُعاد بسطر واحد؛ حذفه يعني
          إعادة كتابته. */}
      {/* <DeliverablesSection /> */}
      <ContactSection initialPlanId={selectedPlanId} />
      <Footer />
      {/* شات المبيعات — للزوار قبل التسجيل */}
      <SalesChat />
    </div>
  );
}
