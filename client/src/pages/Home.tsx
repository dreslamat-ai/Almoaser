import { useState, useEffect, useRef } from "react";
import {
  MessageCircle, Bot, Zap, Shield, ChevronDown, ArrowLeft,
  CheckCircle2, Code2, Database, Layers, Network, Cpu,
  BarChart3, ShoppingCart, Package, BookOpen, DollarSign,
  Send, Terminal, Globe, Lock, AlertCircle, ExternalLink
} from "lucide-react";

// ─── Animated counter hook ───────────────────────────────────────────────────
function useCountUp(target: number, duration = 1500, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return count;
}

// ─── Intersection Observer hook ──────────────────────────────────────────────
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

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${scrolled ? "bg-[oklch(0.09_0.015_240/0.95)] backdrop-blur-xl border-b border-[oklch(0.22_0.025_240)]" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[oklch(0.75_0.18_185/0.15)] border-2 border-[oklch(0.75_0.18_185/0.6)] flex items-center justify-center animate-pulse-glow relative">
            <img src="/manus-storage/logo_icon_ba8a6fa6.png" alt="Logo" className="w-5 h-5 object-contain" />
            <div className="absolute inset-0 rounded-full border border-[oklch(0.75_0.18_185/0.3)] scale-125" />
          </div>
          <span className="font-bold text-sm tracking-wide">
            <span className="glow-text-cyan">AI</span>
            <span className="text-[oklch(0.92_0.005_240)]"> × ERPNext</span>
          </span>
        </div>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-6 text-sm text-[oklch(0.60_0.015_240)]">
          {[
            { label: "المعمارية", href: "#architecture" },
            { label: "آلية العمل", href: "#workflow" },
            { label: "الوكلاء", href: "#agents" },
            { label: "التنفيذ", href: "#implementation" },
          ].map(link => (
            <a key={link.href} href={link.href}
              className="hover:text-[oklch(0.75_0.18_185)] transition-colors duration-200">
              {link.label}
            </a>
          ))}
        </div>

        <a href="#implementation"
          className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.75_0.18_185/0.1)] border border-[oklch(0.75_0.18_185/0.3)] text-[oklch(0.75_0.18_185)] text-sm font-medium hover:bg-[oklch(0.75_0.18_185/0.2)] transition-all duration-200">
          <Zap className="w-4 h-4" />
          ابدأ التنفيذ
        </a>
      </div>
    </nav>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────
function HeroSection() {
  const [typedText, setTypedText] = useState("");
  const messages = [
    "أصدر فاتورة لشركة النور بقيمة 5000 ريال",
    "ما إجمالي مبيعات هذا الشهر؟",
    "سجل قيد محاسبي: مدين الصندوق 3000",
    "أنشئ أمر شراء من مورد الخليج",
  ];
  const [msgIndex, setMsgIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = messages[msgIndex];
    const timeout = setTimeout(() => {
      if (!deleting) {
        if (charIndex < current.length) {
          setTypedText(current.slice(0, charIndex + 1));
          setCharIndex(c => c + 1);
        } else {
          setTimeout(() => setDeleting(true), 1800);
        }
      } else {
        if (charIndex > 0) {
          setTypedText(current.slice(0, charIndex - 1));
          setCharIndex(c => c - 1);
        } else {
          setDeleting(false);
          setMsgIndex(i => (i + 1) % messages.length);
        }
      }
    }, deleting ? 35 : 65);
    return () => clearTimeout(timeout);
  }, [charIndex, deleting, msgIndex]);

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img src="/manus-storage/hero_bg_f4b27899.png" alt="" className="w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.09_0.015_240/0.3)] via-transparent to-[oklch(0.09_0.015_240)]" />
      </div>

      {/* Grid overlay */}
      <div className="absolute inset-0 grid-bg opacity-60" />

      {/* Glow orbs */}
      <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-[oklch(0.75_0.18_185/0.06)] blur-3xl animate-pulse-glow" />
      <div className="absolute bottom-1/3 left-1/4 w-64 h-64 rounded-full bg-[oklch(0.72_0.17_155/0.05)] blur-3xl" style={{ animationDelay: "1.5s" }} />

      <div className="container relative z-10 pt-20">
        <div className="max-w-4xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[oklch(0.75_0.18_185/0.3)] bg-[oklch(0.75_0.18_185/0.08)] mb-6 animate-fade-in-up">
            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.17_155)] animate-pulse" />
            <span className="text-xs font-mono-tech text-[oklch(0.75_0.18_185)]">AI AGENTS × ERPNEXT — الدليل الشامل</span>
          </div>

          {/* Main heading */}
          <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            <span className="text-[oklch(0.92_0.005_240)]">حوّل رسالة </span>
            <span className="glow-text-cyan">واتساب</span>
            <br />
            <span className="text-[oklch(0.92_0.005_240)]">إلى </span>
            <span className="text-[oklch(0.72_0.17_155)]">فاتورة معتمدة</span>
            <br />
            <span className="text-[oklch(0.92_0.005_240)]">في ثوانٍ</span>
          </h1>

          <p className="text-lg text-[oklch(0.60_0.015_240)] max-w-2xl mb-10 leading-relaxed animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            بدلاً من موظفين يُدخلون البيانات يدوياً، وظّف <strong className="text-[oklch(0.75_0.18_185)]">وكلاء ذكاء اصطناعي</strong> متخصصين يعملون على مدار الساعة ويتحدثون مع ERPNext مباشرةً.
          </p>

          {/* Typing demo */}
          <div className="card-tech rounded-xl p-4 mb-8 max-w-xl animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[oklch(0.65_0.22_25)]" />
              <div className="w-2 h-2 rounded-full bg-[oklch(0.75_0.18_55)]" />
              <div className="w-2 h-2 rounded-full bg-[oklch(0.72_0.17_155)]" />
              <span className="text-xs font-mono-tech text-[oklch(0.40_0.015_240)] mr-2">WhatsApp → AI Agent → ERPNext</span>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[oklch(0.72_0.17_155/0.2)] border border-[oklch(0.72_0.17_155/0.4)] flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-[oklch(0.72_0.17_155)]" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[oklch(0.92_0.005_240)]">
                  {typedText}
                  <span className="inline-block w-0.5 h-4 bg-[oklch(0.75_0.18_185)] animate-pulse mr-0.5 align-middle" />
                </p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[oklch(0.22_0.025_240)] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[oklch(0.72_0.17_155)]" />
              <span className="text-xs text-[oklch(0.55_0.015_240)] font-mono-tech">تم التنفيذ في ERPNext ✓</span>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap gap-4 animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            <a href="#architecture"
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[oklch(0.75_0.18_185)] text-[oklch(0.09_0.015_240)] font-semibold hover:bg-[oklch(0.80_0.18_185)] transition-all duration-200 active:scale-95">
              <Layers className="w-4 h-4" />
              استكشف المعمارية
            </a>
            <a href="#implementation"
              className="flex items-center gap-2 px-6 py-3 rounded-lg border border-[oklch(0.22_0.025_240)] text-[oklch(0.80_0.01_240)] hover:border-[oklch(0.75_0.18_185/0.5)] hover:text-[oklch(0.75_0.18_185)] transition-all duration-200">
              <Terminal className="w-4 h-4" />
              دليل التنفيذ
            </a>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[oklch(0.40_0.015_240)] animate-bounce">
        <span className="text-xs font-mono-tech">اسحب للأسفل</span>
        <ChevronDown className="w-4 h-4" />
      </div>
    </section>
  );
}

// ─── Stats Section ────────────────────────────────────────────────────────────
function StatsSection() {
  const { ref, inView } = useInView();
  const s1 = useCountUp(90, 1200, inView);
  const s2 = useCountUp(5, 800, inView);
  const s3 = useCountUp(24, 1000, inView);
  const s4 = useCountUp(100, 1400, inView);

  const stats = [
    { value: s1, suffix: "%", label: "تقليل وقت إدخال البيانات", icon: <Zap className="w-5 h-5" /> },
    { value: s2, suffix: " ثوانٍ", label: "متوسط وقت إنشاء الفاتورة", icon: <CheckCircle2 className="w-5 h-5" /> },
    { value: s3, suffix: "/7", label: "ساعة عمل متواصل", icon: <Bot className="w-5 h-5" /> },
    { value: s4, suffix: "+", label: "عملية ERPNext مدعومة", icon: <Database className="w-5 h-5" /> },
  ];

  return (
    <section ref={ref} className="py-16 border-y border-[oklch(0.22_0.025_240)] bg-[oklch(0.11_0.018_240/0.5)] relative overflow-hidden">
      {/* Connecting line decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-full bg-gradient-to-b from-[oklch(0.75_0.18_185/0.3)] via-[oklch(0.75_0.18_185/0.1)] to-transparent pointer-events-none" />
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <div key={i} className={`text-center animate-fade-in-up relative`} style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="flex justify-center mb-3">
                <div className="w-10 h-10 rounded-lg bg-[oklch(0.75_0.18_185/0.1)] border border-[oklch(0.75_0.18_185/0.2)] flex items-center justify-center text-[oklch(0.75_0.18_185)]">
                  {s.icon}
                </div>
              </div>
              <div className="text-3xl font-bold glow-text-cyan mb-1">
                {s.value}{s.suffix}
              </div>
              <div className="text-sm text-[oklch(0.55_0.015_240)]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Architecture Section ─────────────────────────────────────────────────────
function ArchitectureSection() {
  const { ref, inView } = useInView();

  const layers = [
    {
      icon: <MessageCircle className="w-6 h-6" />,
      title: "طبقة قنوات التواصل",
      subtitle: "Messaging Layer",
      color: "oklch(0.72 0.17 155)",
      items: [
        { name: "WhatsApp Business API", desc: "للعملاء والمبيعات الخارجية", tag: "B2B / B2C" },
        { name: "Telegram Bot API", desc: "للموظفين والعمليات الداخلية", tag: "Internal" },
      ]
    },
    {
      icon: <Cpu className="w-6 h-6" />,
      title: "طبقة الذكاء الاصطناعي",
      subtitle: "AI Orchestration Layer",
      color: "oklch(0.75 0.18 185)",
      items: [
        { name: "n8n Workflow Engine", desc: "تنسيق سير العمل والربط", tag: "Middleware" },
        { name: "GPT-4o / Claude", desc: "فهم اللغة الطبيعية واستدعاء الأدوات", tag: "LLM" },
        { name: "Function Calling", desc: "تنفيذ العمليات في ERPNext", tag: "Tools" },
        { name: "Window Buffer Memory", desc: "ذاكرة سياق المحادثة", tag: "Memory" },
      ]
    },
    {
      icon: <Database className="w-6 h-6" />,
      title: "طبقة نظام ERP",
      subtitle: "ERP Layer",
      color: "oklch(0.75 0.18 55)",
      items: [
        { name: "Frappe REST API", desc: "واجهة CRUD لجميع DocTypes", tag: "API" },
        { name: "Webhooks", desc: "إشعارات استباقية عند تغير الحالة", tag: "Events" },
      ]
    },
  ];

  return (
    <section id="architecture" className="py-24 relative" ref={ref}>
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div className="container relative z-10">
        {/* Header */}
        <div className={`mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-12 bg-[oklch(0.75_0.18_185/0.4)]" />
            <span className="text-xs font-mono-tech text-[oklch(0.75_0.18_185)]">SYSTEM ARCHITECTURE</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-[oklch(0.92_0.005_240)] mb-4">
            المعمارية التقنية
            <span className="glow-text-cyan"> للنظام</span>
          </h2>
          <p className="text-[oklch(0.60_0.015_240)] max-w-2xl text-lg">
            ثلاث طبقات متكاملة تعمل معاً لتحويل رسائل اللغة الطبيعية إلى عمليات فعلية في ERPNext.
          </p>
        </div>

        {/* Architecture visual */}
        <div className={`mb-16 rounded-2xl overflow-hidden border border-[oklch(0.22_0.025_240)] ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.1s" }}>
          <img src="/manus-storage/architecture_visual_6bbafc8c.png" alt="مخطط المعمارية" className="w-full object-cover" />
        </div>

        {/* Layers cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {layers.map((layer, i) => (
            <div key={i} className={`card-tech rounded-xl p-6 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${0.2 + i * 0.1}s` }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: `${layer.color}20`, border: `1px solid ${layer.color}40`, color: layer.color }}>
                  {layer.icon}
                </div>
                <div>
                  <div className="font-semibold text-[oklch(0.92_0.005_240)] text-sm">{layer.title}</div>
                  <div className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)]">{layer.subtitle}</div>
                </div>
              </div>
              <div className="space-y-3">
                {layer.items.map((item, j) => (
                  <div key={j} className="flex items-start gap-3 p-3 rounded-lg bg-[oklch(0.09_0.015_240/0.5)]">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[oklch(0.85_0.005_240)]">{item.name}</div>
                      <div className="text-xs text-[oklch(0.50_0.015_240)] mt-0.5">{item.desc}</div>
                    </div>
                    <span className="text-xs font-mono-tech px-2 py-0.5 rounded"
                      style={{ background: `${layer.color}15`, color: layer.color, border: `1px solid ${layer.color}30` }}>
                      {item.tag}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Workflow Section ─────────────────────────────────────────────────────────
function WorkflowSection() {
  const { ref, inView } = useInView();
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    { icon: <MessageCircle className="w-5 h-5" />, label: "رسالة المستخدم", desc: "يرسل المستخدم أمراً بالعربية عبر واتساب أو تيليجرام", color: "oklch(0.72 0.17 155)", code: '"أصدر فاتورة لشركة النور بقيمة 5000 ريال"' },
    { icon: <Network className="w-5 h-5" />, label: "n8n يستقبل", desc: "Webhook يستقبل الرسالة ويوجهها إلى وكيل الذكاء الاصطناعي", color: "oklch(0.75 0.18 185)", code: 'POST /webhook → n8n AI Agent Node' },
    { icon: <Cpu className="w-5 h-5" />, label: "تحليل النية", desc: "النموذج اللغوي يستخرج: العميل، المبلغ، نوع العملية", color: "oklch(0.75 0.18 185)", code: '{ customer: "شركة النور", amount: 5000, action: "create_invoice" }' },
    { icon: <Code2 className="w-5 h-5" />, label: "Function Calling", desc: "الوكيل يستدعي أداة create_sales_invoice بالمعاملات المستخرجة", color: "oklch(0.75 0.18 55)", code: 'create_sales_invoice(customer, amount, item)' },
    { icon: <Database className="w-5 h-5" />, label: "ERPNext API", desc: "طلب POST لإنشاء الفاتورة كمسودة، ثم PUT للاعتماد", color: "oklch(0.65 0.18 280)", code: 'POST /api/resource/Sales Invoice → docstatus: 1' },
    { icon: <Send className="w-5 h-5" />, label: "رد التأكيد", desc: "الوكيل يرسل تأكيداً للمستخدم برقم الفاتورة", color: "oklch(0.72 0.17 155)", code: '"✅ تم إنشاء SINV-2026-0042 بنجاح"' },
  ];

  useEffect(() => {
    if (!inView) return;
    const interval = setInterval(() => setActiveStep(s => (s + 1) % steps.length), 2000);
    return () => clearInterval(interval);
  }, [inView]);

  return (
    <section id="workflow" className="py-24 bg-[oklch(0.11_0.018_240/0.4)]" ref={ref}>
      <div className="container">
        <div className={`mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-12 bg-[oklch(0.72_0.17_155/0.4)]" />
            <span className="text-xs font-mono-tech text-[oklch(0.72_0.17_155)]">FUNCTION CALLING WORKFLOW</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-[oklch(0.92_0.005_240)] mb-4">
            آلية العمل
            <span className="text-[oklch(0.72_0.17_155)]"> والتدفق</span>
          </h2>
          <p className="text-[oklch(0.60_0.015_240)] max-w-2xl text-lg">
            كيف تتحول رسالة واتساب بسيطة إلى فاتورة معتمدة في ERPNext خلال ثوانٍ معدودة.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, i) => (
              <button key={i} onClick={() => setActiveStep(i)}
                className={`w-full text-right p-4 rounded-xl border transition-all duration-300 ${activeStep === i
                  ? "border-[oklch(0.75_0.18_185/0.5)] bg-[oklch(0.75_0.18_185/0.06)]"
                  : "border-[oklch(0.22_0.025_240)] bg-transparent hover:border-[oklch(0.75_0.18_185/0.2)]"
                  } ${inView ? "animate-fade-in-up" : "opacity-0"}`}
                style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300`}
                    style={{
                      background: activeStep === i ? `${step.color}20` : "oklch(0.17 0.025 240)",
                      color: activeStep === i ? step.color : "oklch(0.45 0.015 240)",
                      border: `1px solid ${activeStep === i ? step.color + "40" : "oklch(0.22 0.025 240)"}`,
                    }}>
                    {step.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono-tech text-[oklch(0.40_0.015_240)]">{String(i + 1).padStart(2, "0")}</span>
                      <span className={`text-sm font-semibold transition-colors ${activeStep === i ? "text-[oklch(0.92_0.005_240)]" : "text-[oklch(0.65_0.015_240)]"}`}>
                        {step.label}
                      </span>
                    </div>
                    {activeStep === i && (
                      <p className="text-xs text-[oklch(0.55_0.015_240)] mt-1 animate-fade-in-up">{step.desc}</p>
                    )}
                  </div>
                  {activeStep === i && <CheckCircle2 className="w-4 h-4 text-[oklch(0.72_0.17_155)] flex-shrink-0" />}
                </div>
              </button>
            ))}
          </div>

          {/* Code preview */}
          <div className={`sticky top-24 ${inView ? "animate-slide-in-right" : "opacity-0"}`}>
            <div className="card-tech rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[oklch(0.22_0.025_240)] bg-[oklch(0.09_0.015_240/0.5)]">
                <div className="w-2.5 h-2.5 rounded-full bg-[oklch(0.65_0.22_25)]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[oklch(0.75_0.18_55)]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[oklch(0.72_0.17_155)]" />
                <span className="text-xs font-mono-tech text-[oklch(0.40_0.015_240)] mr-2">
                  step_{String(activeStep + 1).padStart(2, "0")}.log
                </span>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: `${steps[activeStep].color}20`, color: steps[activeStep].color, border: `1px solid ${steps[activeStep].color}40` }}>
                    {steps[activeStep].icon}
                  </div>
                  <div>
                    <div className="font-semibold text-[oklch(0.92_0.005_240)]">{steps[activeStep].label}</div>
                    <div className="text-xs text-[oklch(0.50_0.015_240)]">{steps[activeStep].desc}</div>
                  </div>
                </div>
                <div className="bg-[oklch(0.07_0.012_240)] rounded-lg p-4 border border-[oklch(0.18_0.02_240)]">
                  <pre className="text-sm font-mono-tech text-[oklch(0.75_0.18_185)] whitespace-pre-wrap leading-relaxed">
                    {steps[activeStep].code}
                  </pre>
                </div>
                {/* Progress bar */}
                <div className="mt-4 flex gap-1.5">
                  {steps.map((_, i) => (
                    <div key={i} className="h-1 flex-1 rounded-full transition-all duration-300"
                      style={{ background: i === activeStep ? steps[activeStep].color : "oklch(0.22 0.025 240)" }} />
                  ))}
                </div>
              </div>
            </div>

            {/* ERPNext note */}
            <div className="mt-4 p-4 rounded-xl border border-[oklch(0.75_0.18_55/0.3)] bg-[oklch(0.75_0.18_55/0.05)]">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-[oklch(0.75_0.18_55)] flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-[oklch(0.75_0.18_55)] mb-1">دورة حياة المستندات في ERPNext</div>
                  <p className="text-xs text-[oklch(0.55_0.015_240)] leading-relaxed">
                    الفواتير والقيود تُنشأ كـ <code className="font-mono-tech text-[oklch(0.75_0.18_185)]">Draft (docstatus:0)</code> أولاً، ثم تُعتمد بـ <code className="font-mono-tech text-[oklch(0.75_0.18_185)]">Submit (docstatus:1)</code> لتُسجَّل في الحسابات.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Agents Section ───────────────────────────────────────────────────────────
function AgentsSection() {
  const { ref, inView } = useInView();
  const [activeAgent, setActiveAgent] = useState(0);

  const agents = [
    {
      icon: <DollarSign className="w-6 h-6" />,
      name: "وكيل المبيعات",
      nameEn: "Sales Agent",
      color: "oklch(0.72 0.17 155)",
      channel: "واتساب",
      tools: ["create_sales_invoice", "create_quotation", "get_customer_balance", "create_sales_order", "send_invoice_email"],
      desc: "يتعامل مع العملاء مباشرةً، يُنشئ عروض الأسعار والفواتير، ويتابع حالة الطلبات.",
      doctypes: ["Sales Invoice", "Quotation", "Sales Order", "Customer"],
      example: "أصدر فاتورة لشركة النور بقيمة 5000 ريال مقابل خدمات استشارية",
    },
    {
      icon: <BookOpen className="w-6 h-6" />,
      name: "وكيل المحاسبة",
      nameEn: "Finance Agent",
      color: "oklch(0.75 0.18 185)",
      channel: "تيليجرام",
      tools: ["create_journal_entry", "create_payment_entry", "get_trial_balance", "get_profit_loss", "reconcile_account"],
      desc: "يُسجّل القيود المحاسبية، يُسجّل الدفعات، ويُنتج التقارير المالية.",
      doctypes: ["Journal Entry", "Payment Entry", "GL Entry", "Account"],
      example: "سجّل قيد: مدين حساب الصندوق 3000، دائن المبيعات 3000",
    },
    {
      icon: <ShoppingCart className="w-6 h-6" />,
      name: "وكيل المشتريات",
      nameEn: "Purchase Agent",
      color: "oklch(0.75 0.18 55)",
      channel: "تيليجرام",
      tools: ["create_purchase_order", "create_purchase_invoice", "get_supplier_list", "approve_purchase", "track_delivery"],
      desc: "يُنشئ أوامر الشراء، يُسجّل فواتير الموردين، ويتابع حالة التسليم.",
      doctypes: ["Purchase Order", "Purchase Invoice", "Supplier", "Material Receipt"],
      example: "أنشئ أمر شراء من مورد الخليج: 100 وحدة قلم بسعر 2 ريال",
    },
    {
      icon: <Package className="w-6 h-6" />,
      name: "وكيل المخزون",
      nameEn: "Inventory Agent",
      color: "oklch(0.65 0.18 280)",
      channel: "تيليجرام",
      tools: ["check_stock_level", "transfer_stock", "create_stock_entry", "get_reorder_items", "adjust_inventory"],
      desc: "يستعلم عن مستويات المخزون، يُحوّل البضاعة بين المستودعات، وينبّه عند نقطة إعادة الطلب.",
      doctypes: ["Stock Entry", "Delivery Note", "Material Receipt", "Warehouse"],
      example: "كم الكمية المتاحة من صنف LAP-001 في مستودع الرياض؟",
    },
    {
      icon: <BarChart3 className="w-6 h-6" />,
      name: "وكيل التقارير",
      nameEn: "Reports Agent",
      color: "oklch(0.70 0.18 320)",
      channel: "واتساب / تيليجرام",
      tools: ["get_sales_report", "get_ar_aging", "get_ap_aging", "get_kpi_dashboard", "compare_monthly_performance"],
      desc: "يُجيب على أسئلة الإدارة بتقارير فورية: المبيعات، الذمم، المؤشرات الرئيسية.",
      doctypes: ["Sales Analytics", "Accounts Receivable", "Accounts Payable", "Balance Sheet"],
      example: "ما إجمالي مبيعات هذا الشهر مقارنةً بالشهر الماضي؟",
    },
  ];

  return (
    <section id="agents" className="py-24 relative" ref={ref}>
      <div className="absolute inset-0 grid-bg opacity-20" />
      <div className="container relative z-10">
        <div className={`mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-12 bg-[oklch(0.65_0.18_280/0.4)]" />
            <span className="text-xs font-mono-tech text-[oklch(0.65_0.18_280)]">MULTI-AGENT SYSTEM</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-[oklch(0.92_0.005_240)] mb-4">
            الوكلاء
            <span className="text-[oklch(0.65_0.18_280)]"> المتخصصون</span>
          </h2>
          <p className="text-[oklch(0.60_0.015_240)] max-w-2xl text-lg">
            بدلاً من وكيل واحد ضخم، نُوظّف وكلاء متخصصين لكل قسم — هذا يُحسّن الدقة ويُقلّل من تشتت النموذج اللغوي.
          </p>
        </div>

        {/* Agent tabs */}
        <div className={`flex flex-wrap gap-2 mb-8 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.15s" }}>
          {agents.map((agent, i) => (
            <button key={i} onClick={() => setActiveAgent(i)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${activeAgent === i ? "text-[oklch(0.09_0.015_240)]" : "text-[oklch(0.60_0.015_240)] border border-[oklch(0.22_0.025_240)] hover:border-[oklch(0.40_0.025_240)]"}`}
              style={activeAgent === i ? { background: agents[i].color } : {}}>
              {agent.icon}
              {agent.name}
            </button>
          ))}
        </div>

        {/* Active agent detail */}
        <div className={`grid md:grid-cols-2 gap-6 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.2s" }}>
          <div className="card-tech rounded-xl p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: `${agents[activeAgent].color}20`, color: agents[activeAgent].color, border: `1px solid ${agents[activeAgent].color}40` }}>
                {agents[activeAgent].icon}
              </div>
              <div>
                <div className="font-bold text-lg text-[oklch(0.92_0.005_240)]">{agents[activeAgent].name}</div>
                <div className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)]">{agents[activeAgent].nameEn}</div>
              </div>
              <div className="mr-auto flex items-center gap-2 px-3 py-1 rounded-full text-xs"
                style={{ background: `${agents[activeAgent].color}15`, color: agents[activeAgent].color, border: `1px solid ${agents[activeAgent].color}30` }}>
                <Globe className="w-3 h-3" />
                {agents[activeAgent].channel}
              </div>
            </div>
            <p className="text-[oklch(0.65_0.015_240)] text-sm leading-relaxed mb-5">{agents[activeAgent].desc}</p>
            {/* Example message */}
            <div className="mb-5 p-3 rounded-lg border border-[oklch(0.22_0.025_240)] bg-[oklch(0.09_0.015_240/0.5)]">
              <div className="flex items-center gap-2 mb-2">
                <MessageCircle className="w-3.5 h-3.5 text-[oklch(0.75_0.18_185)]" />
                <span className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)]">مثال على رسالة المستخدم</span>
              </div>
              <p className="text-sm text-[oklch(0.80_0.005_240)]">"{agents[activeAgent].example}"</p>
            </div>
            <div>
              <div className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)] mb-3">DocTypes المدعومة:</div>
              <div className="flex flex-wrap gap-2">
                {agents[activeAgent].doctypes.map((dt, i) => (
                  <span key={i} className="text-xs font-mono-tech px-2.5 py-1 rounded-md bg-[oklch(0.09_0.015_240/0.5)] border border-[oklch(0.22_0.025_240)] text-[oklch(0.65_0.015_240)]">
                    {dt}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="card-tech rounded-xl p-6">
            <div className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)] mb-4">الأدوات المتاحة (Tools):</div>
            <div className="space-y-2">
              {agents[activeAgent].tools.map((tool, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-[oklch(0.09_0.015_240/0.5)] border border-[oklch(0.18_0.02_240)]"
                  style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: agents[activeAgent].color }} />
                  <code className="text-sm font-mono-tech text-[oklch(0.75_0.18_185)]">{tool}</code>
                </div>
              ))}
            </div>
            {/* Status indicator */}
            <div className="mt-4 pt-4 border-t border-[oklch(0.22_0.025_240)] flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[oklch(0.72_0.17_155)] animate-pulse" />
              <span className="text-xs font-mono-tech text-[oklch(0.45_0.015_240)]">AGENT STATUS: ACTIVE — متصل ويعمل</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Implementation Section ───────────────────────────────────────────────────
function ImplementationSection() {
  const { ref, inView } = useInView();

  const steps = [
    {
      num: "01",
      title: "تجهيز واجهات ERPNext",
      color: "oklch(0.72 0.17 155)",
      items: [
        "إنشاء مستخدم مخصص للـ API (ai_integration_user)",
        "توليد API Key و API Secret من إعدادات المستخدم",
        "تكوين Authorization Token: token api_key:api_secret",
        "تحديد الصلاحيات (Roles) بدقة لتجنب العمليات غير المصرح بها",
      ],
      code: `curl -X GET https://your-erp.com/api/method/frappe.auth.get_logged_user \\
  -H "Authorization: token api_key:api_secret"`,
    },
    {
      num: "02",
      title: "إعداد n8n وبناء الأدوات",
      color: "oklch(0.75 0.18 185)",
      items: [
        "تثبيت n8n عبر Docker أو Coolify",
        "إنشاء Workflow جديد مع Webhook Trigger",
        "إضافة عقدة AI Agent مع نموذج GPT-4o",
        "تعريف الأدوات (Tools) كـ HTTP Request Nodes",
      ],
      code: `// تعريف أداة في n8n
{
  "name": "create_sales_invoice",
  "description": "إنشاء فاتورة مبيعات في ERPNext",
  "parameters": {
    "customer": "string",
    "amount": "number",
    "item_description": "string"
  }
}`,
    },
    {
      num: "03",
      title: "ربط واتساب وتيليجرام",
      color: "oklch(0.75 0.18_55)",
      items: [
        "إنشاء WhatsApp Business Account وتفعيل Cloud API",
        "إنشاء Telegram Bot عبر @BotFather",
        "ضبط Webhook URLs لكلا القناتين في n8n",
        "اختبار استقبال الرسائل والرد عليها",
      ],
      code: `// Telegram Webhook
POST https://api.telegram.org/bot{TOKEN}/setWebhook
{
  "url": "https://your-n8n.com/webhook/telegram"
}`,
    },
    {
      num: "04",
      title: "الاختبار والإطلاق",
      color: "oklch(0.65 0.18 280)",
      items: [
        "اختبار السيناريوهات المختلفة باللغة العربية",
        "معالجة الأخطاء وحالات نقص البيانات",
        "إعداد نظام مراقبة وتسجيل العمليات",
        "توظيف الوكلاء وتخصيص كل وكيل لقسمه",
      ],
      code: `// مثال: الوكيل يطلب توضيحاً
User: "أصدر فاتورة بـ 5000"
Agent: "لأي عميل تريد إصدار الفاتورة؟
         وما هو البيان أو الخدمة المقدمة؟"`,
    },
  ];

  const tools = [
    { name: "n8n", role: "أتمتة وربط الأنظمة", type: "Open Source", color: "oklch(0.75 0.18 185)" },
    { name: "OpenAI GPT-4o", role: "فهم اللغة الطبيعية", type: "API", color: "oklch(0.72 0.17 155)" },
    { name: "WhatsApp Cloud API", role: "قناة العملاء", type: "Meta", color: "oklch(0.72 0.17 155)" },
    { name: "Telegram Bot API", role: "قناة الموظفين", type: "Free", color: "oklch(0.65 0.18 280)" },
    { name: "Frappe REST API", role: "واجهة ERPNext", type: "Built-in", color: "oklch(0.75 0.18 55)" },
    { name: "Docker / Coolify", role: "استضافة n8n", type: "Self-hosted", color: "oklch(0.70 0.18 320)" },
  ];

  return (
    <section id="implementation" className="py-24 bg-[oklch(0.11_0.018_240/0.4)]" ref={ref}>
      <div className="container">
        <div className={`mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-12 bg-[oklch(0.75_0.18_55/0.4)]" />
            <span className="text-xs font-mono-tech text-[oklch(0.75_0.18_55)]">IMPLEMENTATION ROADMAP</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-[oklch(0.92_0.005_240)] mb-4">
            خارطة
            <span className="text-[oklch(0.75_0.18_55)]"> التنفيذ</span>
          </h2>
          <p className="text-[oklch(0.60_0.015_240)] max-w-2xl text-lg">
            أربع مراحل عملية لتحويل هذه المعمارية إلى نظام حقيقي يعمل في بيئة الإنتاج.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-6 mb-16">
          {steps.map((step, i) => (
            <div key={i} className={`card-tech rounded-xl overflow-hidden ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="grid md:grid-cols-2">
                <div className="p-6 border-b md:border-b-0 md:border-l border-[oklch(0.22_0.025_240)]" style={{ borderColor: "oklch(0.22 0.025 240)" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl font-bold font-mono-tech" style={{ color: step.color }}>{step.num}</span>
                    <h3 className="text-lg font-semibold text-[oklch(0.92_0.005_240)]">{step.title}</h3>
                  </div>
                  <ul className="space-y-2">
                    {step.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-[oklch(0.65_0.015_240)]">
                        <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: step.color }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 bg-[oklch(0.07_0.012_240/0.5)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Terminal className="w-3.5 h-3.5 text-[oklch(0.45_0.015_240)]" />
                    <span className="text-xs font-mono-tech text-[oklch(0.40_0.015_240)]">code example</span>
                  </div>
                  <pre className="text-xs font-mono-tech text-[oklch(0.70_0.015_240)] whitespace-pre-wrap leading-relaxed overflow-x-auto">
                    {step.code}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tools table */}
        <div className={`${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: "0.4s" }}>
          <h3 className="text-xl font-bold text-[oklch(0.92_0.005_240)] mb-6 flex items-center gap-3">
            <Layers className="w-5 h-5 text-[oklch(0.75_0.18_185)]" />
            الأدوات التقنية الموصى بها
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map((tool, i) => (
              <div key={i} className="card-tech rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${tool.color}15`, border: `1px solid ${tool.color}30` }}>
                  <Code2 className="w-5 h-5" style={{ color: tool.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[oklch(0.92_0.005_240)] truncate">{tool.name}</div>
                  <div className="text-xs text-[oklch(0.50_0.015_240)]">{tool.role}</div>
                </div>
                <span className="text-xs font-mono-tech px-2 py-0.5 rounded flex-shrink-0"
                  style={{ background: `${tool.color}15`, color: tool.color, border: `1px solid ${tool.color}30` }}>
                  {tool.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Security Section ─────────────────────────────────────────────────────────
function SecuritySection() {
  const { ref, inView } = useInView();

  const challenges = [
    {
      icon: <Lock className="w-5 h-5" />,
      title: "الأمان وصلاحيات الوصول",
      color: "oklch(0.72 0.17 155)",
      problem: "الوكيل قد ينفذ عمليات غير مصرح بها إذا لم تُحدَّد الصلاحيات بدقة.",
      solution: "إنشاء أدوار (Roles) مخصصة في ERPNext تمنح الإنشاء والقراءة فقط، دون صلاحية الحذف أو التعديل على مستندات معتمدة.",
    },
    {
      icon: <AlertCircle className="w-5 h-5" />,
      title: "التعامل مع البيانات الناقصة",
      color: "oklch(0.75 0.18_55)",
      problem: "المستخدم يطلب \"أصدر فاتورة بـ 500\" دون تحديد العميل أو الصنف.",
      solution: "برمجة الوكيل ليطرح أسئلة توضيحية (Clarifying Questions) قبل استدعاء أي أداة تتطلب بيانات ناقصة.",
    },
    {
      icon: <Database className="w-5 h-5" />,
      title: "دورة حياة المستندات",
      color: "oklch(0.75 0.18 185)",
      problem: "إنشاء مستند مالي بدون اعتماد لا يُسجَّل في الحسابات — يبقى مسودة.",
      solution: "تنفيذ خطوتين تلقائياً: POST للإنشاء كمسودة، ثم PUT للاعتماد (docstatus:1)، مع خيار طلب موافقة المدير قبل الاعتماد.",
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: "أخطاء واجهة برمجة التطبيقات",
      color: "oklch(0.65 0.18 280)",
      problem: "ERPNext قد يُعيد خطأ (نقص مخزون، عميل غير موجود) يجب ترجمته للمستخدم.",
      solution: "معالجة استجابات الخطأ من الـ API وإعادة صياغتها بلغة عربية مفهومة مع اقتراح الحل.",
    },
  ];

  return (
    <section className="py-24 relative" ref={ref}>
      <div className="container">
        <div className={`mb-16 ${inView ? "animate-fade-in-up" : "opacity-0"}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-12 bg-[oklch(0.65_0.22_25/0.4)]" />
            <span className="text-xs font-mono-tech text-[oklch(0.65_0.22_25)]">CHALLENGES & SOLUTIONS</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-bold text-[oklch(0.92_0.005_240)] mb-4">
            التحديات
            <span className="text-[oklch(0.65_0.22_25)]"> والحلول</span>
          </h2>
          <p className="text-[oklch(0.60_0.015_240)] max-w-2xl text-lg">
            أبرز التحديات التقنية التي ستواجهها عند بناء هذا النظام، مع الحلول العملية لكل منها.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {challenges.map((c, i) => (
            <div key={i} className={`card-tech rounded-xl p-6 ${inView ? "animate-fade-in-up" : "opacity-0"}`} style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: `${c.color}20`, color: c.color, border: `1px solid ${c.color}40` }}>
                  {c.icon}
                </div>
                <h3 className="font-semibold text-[oklch(0.92_0.005_240)]">{c.title}</h3>
              </div>
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[oklch(0.65_0.22_25/0.05)] border border-[oklch(0.65_0.22_25/0.2)]">
                  <div className="text-xs font-mono-tech text-[oklch(0.65_0.22_25)] mb-1">التحدي</div>
                  <p className="text-sm text-[oklch(0.65_0.015_240)]">{c.problem}</p>
                </div>
                <div className="p-3 rounded-lg bg-[oklch(0.72_0.17_155/0.05)] border border-[oklch(0.72_0.17_155/0.2)]">
                  <div className="text-xs font-mono-tech text-[oklch(0.72_0.17_155)] mb-1">الحل</div>
                  <p className="text-sm text-[oklch(0.65_0.015_240)]">{c.solution}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-[oklch(0.22_0.025_240)] py-12 bg-[oklch(0.07_0.012_240)]">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[oklch(0.75_0.18_185/0.15)] border-2 border-[oklch(0.75_0.18_185/0.5)] flex items-center justify-center relative">
              <img src="/manus-storage/logo_icon_ba8a6fa6.png" alt="Logo" className="w-5 h-5 object-contain" />
              <div className="absolute inset-0 rounded-full border border-[oklch(0.75_0.18_185/0.2)] scale-125" />
            </div>
            <div>
              <div className="font-bold text-sm text-[oklch(0.92_0.005_240)]">
                <span className="glow-text-cyan">AI Agents</span> × ERPNext
              </div>
              <div className="text-xs text-[oklch(0.45_0.015_240)]">الدليل الشامل للأتمتة الذكية</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-[oklch(0.50_0.015_240)]">
            {[
              { label: "Frappe REST API", href: "https://docs.frappe.io/framework/user/en/api/rest" },
              { label: "n8n AI Agents", href: "https://n8n.io" },
              { label: "OpenAI Function Calling", href: "https://platform.openai.com/docs/guides/function-calling" },
            ].map(link => (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-[oklch(0.75_0.18_185)] transition-colors">
                {link.label}
                <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>

          <div className="text-xs text-[oklch(0.35_0.015_240)] font-mono-tech">
            © 2026 — AI Agents × ERPNext
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen bg-[oklch(0.09_0.015_240)]">
      <Navbar />
      <HeroSection />
      <StatsSection />
      <ArchitectureSection />
      <WorkflowSection />
      <AgentsSection />
      <ImplementationSection />
      <SecuritySection />
      <Footer />
    </div>
  );
}
