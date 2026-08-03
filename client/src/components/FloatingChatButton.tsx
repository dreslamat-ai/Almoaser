import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X } from "lucide-react";
import { SaraAvatar } from "./SaraAvatar";

/**
 * زرّ سارة العائم — يفتح المحادثة مباشرة.
 *
 * **كان قائمةً بثلاث قنوات** (تيليجرام، الشات، واتساب). حُذفت القناتان
 * الخارجيتان بقرار صاحب المنتج، ولمّا بقي خيارٌ واحد لم تعد القائمة قائمة:
 * نقرةٌ تفتح قائمةً بندُها الوحيد ما كانت النقرة ستفعله. فصار الزرّ يفتح
 * المحادثة مباشرة.
 *
 * **ولا يظهر فوق المحادثة نفسها:** كان يطفو على شاشة الشات وأنت فيها بالفعل،
 * ويغطّي حقل الكتابة.
 */

/** بعد صمتٍ بهذا القدر تبادر سارة بالمساعدة — لا قبله */
const NUDGE_AFTER_MS = 10_000;
/** مرّة واحدة في الجلسة: تكرارها في كل صفحة يجعلها إزعاجاً لا عرضاً */
const NUDGE_SEEN_KEY = "sara_nudge_seen";

export default function FloatingChatButton() {
  const [location, navigate] = useLocation();
  const [nudge, setNudge] = useState(false);
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

  if (location.startsWith("/agent")) return null;

  const closeNudge = () => { dismissed.current = true; setNudge(false); };
  const openChat = () => { closeNudge(); navigate("/agent"); };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex flex-col items-start gap-3" dir="rtl">
      {nudge && (
        <div className="relative flex items-start gap-2 bg-white rounded-2xl shadow-lg border border-gray-100 py-2.5 pr-3 pl-8 max-w-[16rem] animate-fade-in-up">
          <SaraAvatar className="w-8 h-8" />
          <button onClick={openChat} className="text-right text-[12.5px] leading-relaxed text-navy">
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

      <button
        onClick={openChat}
        aria-label="تحدّث مع المحاسب الذكي"
        title="تحدّث مع المحاسب الذكي"
        className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center overflow-hidden ring-2 ring-gold bg-white transition-all duration-200 active:scale-95 hover:ring-gold/70 hover:shadow-2xl"
      >
        <SaraAvatar className="w-full h-full" bordered={false} />
      </button>
    </div>
  );
}
