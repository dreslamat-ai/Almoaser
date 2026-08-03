import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, Send, Bot, X } from "lucide-react";
import { SaraAvatar } from "./SaraAvatar";

/**
 * زر دردشة عائم يظهر في كل صفحات لوحة التحكم.
 * يفتح قائمة بثلاث قنوات: تليجرام، الشات المباشر داخل الموقع، وواتساب.
 */
/** بعد صمتٍ بهذا القدر تبادر سارة بالمساعدة — لا قبله */
const NUDGE_AFTER_MS = 10_000;
/** مرّة واحدة في الجلسة: تكرارها في كل صفحة يجعلها إزعاجاً لا عرضاً */
const NUDGE_SEEN_KEY = "sara_nudge_seen";

export default function FloatingChatButton() {
  const [open, setOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [, navigate] = useLocation();
  const dismissed = useRef(false);

  // ─── مبادرةٌ بعد صمت ──────────────────────────────────────────────────
  // من يقف عشر ثوانٍ في صفحة غالباً لا يعرف خطوته التالية. الفقاعة تُعرض
  // مرّة واحدة في الجلسة وتُغلق بلمسة، ولا تعود بعد إغلاقها — العرض الذي
  // يتكرّر يُغلَق بلا قراءة ثم يُغلَق البابُ كلّه معه.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(NUDGE_SEEN_KEY)) return;
    const t = window.setTimeout(() => {
      if (!dismissed.current) { setNudge(true); sessionStorage.setItem(NUDGE_SEEN_KEY, "1"); }
    }, NUDGE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  const closeNudge = () => { dismissed.current = true; setNudge(false); };

  const options = [
    {
      label: "تليجرام",
      desc: "Almoaser Bot — رد فوري",
      icon: <Send className="w-5 h-5" />,
      color: "bg-[#2AABEE] text-white",
      onClick: () => window.open("https://t.me/AlmoaserBot", "_blank", "noopener,noreferrer"),
    },
    {
      label: "الشات المباشر",
      desc: "المحادثة الذكية داخل الموقع",
      icon: <Bot className="w-5 h-5" />,
      color: "bg-navy-gradient text-white",
      onClick: () => { setOpen(false); navigate("/agent"); },
    },
    {
      label: "واتساب",
      desc: "تواصل مع فريق الدعم",
      icon: <MessageCircle className="w-5 h-5" />,
      color: "bg-green-500 text-white",
      onClick: () => window.open("https://wa.me/966564677377", "_blank", "noopener,noreferrer"),
    },
  ];

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-3" dir="rtl">
      {nudge && !open && (
        <div className="relative flex items-start gap-2 bg-white rounded-2xl shadow-lg border border-gray-100 py-2.5 pr-3 pl-8 max-w-[16rem] animate-fade-in-up">
          <SaraAvatar className="w-8 h-8" />
          <button
            onClick={() => { closeNudge(); setOpen(false); navigate("/agent"); }}
            className="text-right text-[12.5px] leading-relaxed text-navy"
          >
            محتاج مساعدة في أي خطوة؟ اسألني وأنفّذها لك 👋
          </button>
          <button
            onClick={closeNudge}
            aria-label="إغلاق"
            className="absolute top-1 left-1 w-6 h-6 rounded-full text-muted-foreground hover:bg-gray-100 flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {open && (
        <div className="flex flex-col gap-2 mb-1">
          {options.map((opt, i) => (
            <button
              key={opt.label}
              onClick={opt.onClick}
              className="flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-gray-100 pl-5 pr-2 py-2 hover:shadow-xl transition-all animate-fade-in-up active:scale-[0.97]"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${opt.color}`}>
                {opt.icon}
              </span>
              <span className="text-right">
                <span className="block text-sm font-bold text-navy">{opt.label}</span>
                <span className="block text-[11px] text-muted-foreground">{opt.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {/* وجه سارة لا أيقونة محادثة عامة: الزرّ يقول مع من ستتحدّث */}
      <button
        onClick={() => { closeNudge(); setOpen(o => !o); }}
        aria-label={open ? "إغلاق قائمة الدردشة" : "تحدّث مع سارة"}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 active:scale-95 overflow-hidden ${
          open ? "bg-navy-gradient rotate-90" : "ring-2 ring-gold bg-white hover:ring-gold/70"}`}
      >
        {open ? <X className="w-6 h-6 text-white" /> : <SaraAvatar className="w-full h-full" bordered={false} />}
      </button>
    </div>
  );
}

