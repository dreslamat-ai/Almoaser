import { useState } from "react";
import { useLocation } from "wouter";
import { MessageCircle, Send, Bot, X } from "lucide-react";

/**
 * زر دردشة عائم يظهر في كل صفحات لوحة التحكم.
 * يفتح قائمة بثلاث قنوات: تليجرام، الشات المباشر داخل الموقع، وواتساب.
 */
export default function FloatingChatButton() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

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
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "إغلاق قائمة الدردشة" : "فتح قائمة الدردشة"}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 active:scale-95 ${open ? "bg-navy-gradient rotate-90" : "bg-gold hover:bg-gold/90"}`}
      >
        {open ? <X className="w-6 h-6 text-white" /> : <MessageCircle className="w-6 h-6 text-white" />}
      </button>
    </div>
  );
}

