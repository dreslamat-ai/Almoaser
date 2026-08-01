import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { MessageCircle, X, Send, Loader2, ArrowLeft } from "lucide-react";
import { SALES_MAX_CHARS } from "@shared/salesLimits";

type Msg = { role: "user" | "assistant"; content: string; planId?: number | null; planName?: string | null };

const GREETING: Msg = {
  role: "assistant",
  content: "أهلاً بك 👋 أنا سارة من المعاصر AI. تحب أشرح لك كيف تشتغل المنصة مع نظامك، ولا عندك سؤال معيّن؟",
};

// المحادثة تبقى بعد الانتقال لصفحة التسجيل: العميل يضغط الزر فتُفقد الحالة
// بالتنقّل، فيعود ويجد الشات فارغاً وكأن أحداً لم يكلّمه. sessionStorage يكفي —
// نريدها للجلسة لا للأبد.
const STORE_KEY = "sales_chat_v1";

function loadStored(): { messages: Msg[]; open: boolean; leadId: number | null; activePlan: { id: number; name: string | null } | null } | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { messages?: Msg[]; open?: boolean; leadId?: number | null; activePlan?: { id: number; name: string | null } | null };
    return Array.isArray(v.messages) && v.messages.length ? { messages: v.messages, open: !!v.open, leadId: v.leadId ?? null, activePlan: v.activePlan ?? null } : null;
  } catch { return null; }
}

export default function SalesChat() {
  const stored = typeof window !== "undefined" ? loadStored() : null;
  // يُفتح تلقائياً عند العودة من التسجيل ليكمل الحديث لا ليبدأ من جديد
  const [open, setOpen] = useState(stored?.open ?? false);
  const [messages, setMessages] = useState<Msg[]>(stored?.messages ?? [GREETING]);
  const [input, setInput] = useState("");
  const [leadId, setLeadId] = useState<number | null>(stored?.leadId ?? null);
  // الباقة تبقى معروفة بعد أول ترشيح: سارة لا تعيد إصدار العلامة في كل رسالة،
  // فبدونها يختفي الزر عن آخر رسالة ويظل معلّقاً برسالة قديمة فوق — والعميل
  // يُسأل "جاهز تبدأ؟" بلا زر أمامه.
  const [activePlan, setActivePlan] = useState<{ id: number; name: string | null } | null>(
    stored?.activePlan ?? null,
  );
  const endRef = useRef<HTMLDivElement | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  // الفرق بين ارتفاع النافذة وارتفاع المنطقة المرئية هو الكيبورد (وأشرطة
  // المتصفح المتحركة). أقل من 120px غالباً شريط عنوان لا كيبورد، فنتجاهله
  // حتى لا تقفز اللوحة مع كل تمرير.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset > 120 ? inset : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);

  const chat = trpc.sales.chat.useMutation({
    onSuccess: r => {
      if (r.leadId) setLeadId(r.leadId);
      if (r.planId) setActivePlan({ id: r.planId, name: r.planName ?? null });
      setMessages(m => [...m, { role: "assistant", content: r.reply, planId: r.planId, planName: r.planName }]);
    },
    onError: e => setMessages(m => [...m, { role: "assistant", content: e.message }]),
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open, keyboardInset]);

  useEffect(() => {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages, open, leadId, activePlan })); } catch { /* الحفظ ليس جوهرياً */ }
  }, [messages, open, leadId, activePlan]);

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    // آخر رسائل فقط: المحادثة الطويلة تكلفة علينا، والسياق البعيد لا يفيد البيع
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    // نرسل الدور والنص فقط — الزر حالة عرض لا جزء من المحادثة
    chat.mutate({
      messages: next.filter(m => m.content !== GREETING.content).slice(-12)
        .map(m => ({ role: m.role, content: m.content })),
      ...(leadId ? { leadId } : {}),
    });
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="تحدث مع مستشارة الحلول"
          /* الصفحة فيها أقسام بيضاء وأخرى كحلية داكنة، ولا لون حشو واحد يظهر
             على الاثنين: الكحلي يختفي على الفوتر والأبيض يختفي على الأقسام
             البيضاء. الحشو الذهبي يحمل التباين على الداكن (7.8:1) والحلقة
             الكحلية تحمله على الفاتح (17.3:1)، فيبقى الحدّ واضحاً دائماً. */
          className="fixed left-5 z-40 flex items-center gap-2 rounded-full bg-gold text-navy font-bold ring-2 ring-navy shadow-lg px-4 h-12 hover:brightness-105 transition-all"
          style={{ bottom: `calc(1.25rem + ${keyboardInset}px)` }}
        >
          <MessageCircle className="w-5 h-5" />
          <span className="text-sm font-medium">اسأل سارة</span>
        </button>
      )}

      {open && (
        /* الكيبورد على الجوال يقلّص المنطقة المرئية لكنه لا يحرّك العناصر
           الثابتة، فيختفي حقل الكتابة خلفه. visualViewport هو ما يعرف ارتفاعه
           فعلاً — نرفع اللوحة بمقداره ونقلّص ارتفاعها بالتبعية. */
        <div className="fixed left-5 z-50 w-[min(92vw,22rem)] rounded-2xl border border-border bg-white shadow-2xl flex flex-col overflow-hidden"
          style={{
            bottom: `calc(1.25rem + ${keyboardInset}px)`,
            maxHeight: `min(80dvh, 34rem, calc(100dvh - ${keyboardInset}px - 3rem))`,
          }}>
          <div className="flex items-center justify-between gap-2 bg-navy text-white px-4 py-3 shrink-0">
            <div className="min-w-0">
              <div className="font-bold text-sm">سارة — مستشارة الحلول</div>
              <div className="text-[11px] text-white/70">المعاصر AI · ترد خلال ثوانٍ</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="إغلاق المحادثة"
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {messages.map((m, i) => {
              const isLastAssistant = m.role === "assistant" && i === messages.length - 1;
              // زر واحد فقط، تحت آخر رسالة: تركه معلّقاً برسائل قديمة يبعثر
              // أزراراً في المحادثة ويترك آخر سؤال "جاهز تبدأ؟" بلا زر أمامه.
              const plan = !isLastAssistant ? null
                : m.planId != null ? { id: m.planId, name: m.planName ?? null }
                : activePlan;
              return (
              <div key={i} className={m.role === "user" ? "text-left" : "text-right"}>
                <div className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-6 ${
                  m.role === "user" ? "bg-navy text-white" : "bg-white border border-border text-foreground"
                }`}>{m.content}</div>
                {plan && (
                  <div className="mt-2">
                    <a href={`/signup?plan=${plan.id}`}
                      onClick={() => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ messages, open: true, leadId, activePlan })); } catch { /* لا شيء */ } }}
                      className="inline-flex items-center gap-2 rounded-xl bg-navy text-white font-bold text-sm px-4 h-11 shadow-sm hover:bg-navy-dark transition-colors">
                      ابدأ التسجيل{plan.name ? ` — ${plan.name}` : ""}
                      <ArrowLeft className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>
              );
            })}
            {chat.isPending && (
              <div className="text-right">
                <div className="inline-flex items-center gap-2 rounded-2xl bg-white border border-border px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> تكتب...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="p-2 border-t border-border bg-white shrink-0">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value.slice(0, SALES_MAX_CHARS))}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="اكتب سؤالك..."
                aria-label="اكتب سؤالك لمستشارة الحلول"
                className="flex-1 h-11 rounded-xl border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-navy/20"
              />
              <Button onClick={send} disabled={!input.trim() || chat.isPending}
                aria-label="إرسال" size="icon" className="h-11 w-11 shrink-0 bg-navy text-white">
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              للاستفسارات عن المنصة والباقات — لا تُشارك بيانات دخول أو أرقام بطاقات.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
