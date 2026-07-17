import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Streamdown } from "streamdown";
import {
  Bot, Send, User, Sparkles, Loader2, Trash2,
  FileText, BarChart3, Users, Package, MessageSquare,
} from "lucide-react";

type Message = { role: "user" | "assistant"; content: string; ts: number };

const SUGGESTIONS = [
  { icon: FileText, text: "ما هي آخر الفواتير؟" },
  { icon: Users, text: "كم عدد العملاء المسجلين؟" },
  { icon: BarChart3, text: "أعطني ملخص المبيعات" },
  { icon: Package, text: "ما هي الأصناف المتاحة؟" },
  { icon: FileText, text: "أنشئ فاتورة لعميل جديد" },
  { icon: BarChart3, text: "ما هو إجمالي الإيرادات؟" },
];

export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.erpnext.agentChat.useMutation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || chatMutation.isPending) return;
    setInput("");

    const userMsg: Message = { role: "user", content, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    try {
      const result = await chatMutation.mutateAsync({
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(prev => [...prev, { role: "assistant", content: result.reply, ts: Date.now() }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ حدث خطأ: ${err instanceof Error ? err.message : "تعذّر الاتصال بالوكيل"}`,
        ts: Date.now(),
      }]);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] max-w-4xl mx-auto gap-4">

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">وكيل الذكاء الاصطناعي</h1>
              <p className="text-xs text-muted-foreground">متصل بـ ERPNext · يستطيع إنشاء الفواتير وجلب التقارير</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              متصل
            </Badge>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5 text-muted-foreground" onClick={() => setMessages([])}>
                <Trash2 className="w-3.5 h-3.5" /> مسح
              </Button>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <Card className="flex-1 overflow-hidden shadow-sm flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Welcome */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-bold text-foreground mb-1">مرحباً! أنا وكيل ERPNext الذكي</h2>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    يمكنني مساعدتك في إنشاء الفواتير، جلب التقارير، الاستعلام عن العملاء والأصناف، وتنفيذ العمليات المحاسبية.
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-lg">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => void send(s.text)}
                      className="flex items-center gap-2 p-3 rounded-xl border border-border bg-muted/40 hover:bg-muted hover:border-primary/30 transition-all text-right text-sm text-foreground group">
                      <s.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                      <span className="truncate">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-violet-100 text-violet-600"
                }`}>
                  {msg.role === "user" ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted/60 text-foreground rounded-tl-sm border border-border"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <Streamdown>{msg.content}</Streamdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Loading */}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-violet-600" />
                </div>
                <div className="bg-muted/60 border border-border rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">الوكيل يفكر...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 shrink-0">
            <div className="flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="اكتب أمرك... مثال: أنشئ فاتورة لشركة النور بقيمة 500 ريال"
                className="flex-1 min-h-[44px] max-h-32 resize-none text-sm"
                rows={1}
                disabled={chatMutation.isPending}
              />
              <Button
                onClick={() => void send()}
                disabled={!input.trim() || chatMutation.isPending}
                size="icon"
                className="h-11 w-11 shrink-0"
              >
                {chatMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              <MessageSquare className="w-3 h-3 inline ml-1" />
              اضغط Enter للإرسال · Shift+Enter لسطر جديد
            </p>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
