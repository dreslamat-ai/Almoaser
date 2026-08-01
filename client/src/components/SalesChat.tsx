import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { SALES_MAX_CHARS } from "@shared/salesLimits";

type Msg = { role: "user" | "assistant"; content: string };

const GREETING: Msg = {
  role: "assistant",
  content: "أهلاً بك 👋 أنا سارة من المعاصر AI. تحب أشرح لك كيف تشتغل المنصة مع نظامك، ولا عندك سؤال معيّن؟",
};

export default function SalesChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const chat = trpc.sales.chat.useMutation({
    onSuccess: r => setMessages(m => [...m, { role: "assistant", content: r.reply }]),
    onError: e => setMessages(m => [...m, { role: "assistant", content: e.message }]),
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, open]);

  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending) return;
    // آخر رسائل فقط: المحادثة الطويلة تكلفة علينا، والسياق البعيد لا يفيد البيع
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    chat.mutate({ messages: next.filter(m => m.content !== GREETING.content).slice(-12) });
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="تحدث مع مستشارة الحلول"
          className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full bg-navy text-white shadow-lg px-4 h-12 hover:opacity-90 transition-opacity"
        >
          <MessageCircle className="w-5 h-5" />
          <span className="text-sm font-medium">اسأل سارة</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 left-5 z-50 w-[min(92vw,22rem)] rounded-2xl border border-border bg-white shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: "min(80vh, 34rem)" }}>
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
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-left" : "text-right"}>
                <div className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-6 ${
                  m.role === "user" ? "bg-navy text-white" : "bg-white border border-border text-foreground"
                }`}>{m.content}</div>
              </div>
            ))}
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
