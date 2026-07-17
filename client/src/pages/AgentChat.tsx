import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  Bot, Send, User, Sparkles, Loader2, Trash2,
  FileText, BarChart3, Users, Package, MessageSquare,
  Download, CheckCircle2, AlertCircle, TrendingUp,
  Mic, Square, ImagePlus, Camera,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type ToolResult = { tool_call_id: string; tool_name: string; display: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  ts: number;
  toolResults?: ToolResult[];
};

// ─── ERPNext Data Types ───────────────────────────────────────────────────────
interface Invoice {
  name: string;
  customer: string;
  posting_date: string;
  due_date?: string;
  grand_total: number;
  outstanding_amount?: number;
  status: string;
  currency?: string;
}

interface Customer {
  name: string;
  customer_name: string;
  customer_type?: string;
  mobile_no?: string;
  email_id?: string;
}

interface Item {
  name: string;
  item_name: string;
  item_group?: string;
  standard_rate?: number;
  stock_uom?: string;
}

interface SalesReport {
  period: string;
  fromDate: string;
  toDate: string;
  totalInvoices: number;
  totalRevenue: number;
  paidRevenue: number;
  unpaidRevenue: number;
}

interface InvoiceDetail {
  name: string;
  customer: string;
  posting_date: string;
  due_date?: string;
  grand_total: number;
  outstanding_amount?: number;
  status: string;
  currency?: string;
  items?: Array<{ item_code: string; item_name: string; qty: number; rate: number; amount: number }>;
}

interface CreatedInvoice {
  name: string;
  customer: unknown;
  items: unknown;
  grand_total?: number;
}

// ─── Tool Result Renderers ────────────────────────────────────────────────────
function InvoicesTable({ invoices, onDownload }: { invoices: Invoice[]; onDownload: (name: string) => void }) {
  const statusColor = (s: string) => {
    if (s === "Paid") return "bg-emerald-100 text-emerald-700";
    if (s === "Unpaid") return "bg-amber-100 text-amber-700";
    if (s === "Overdue") return "bg-red-100 text-red-700";
    return "bg-gray-100 text-gray-600";
  };
  const statusLabel = (s: string) => ({ Paid: "مدفوعة", Unpaid: "غير مدفوعة", Overdue: "متأخرة", Draft: "مسودة", Cancelled: "ملغاة" }[s] ?? s);
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <FileText className="w-4 h-4 text-primary" />
        <span className="font-semibold text-foreground">الفواتير ({invoices.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-right font-medium">رقم الفاتورة</th>
              <th className="px-3 py-2 text-right font-medium">العميل</th>
              <th className="px-3 py-2 text-right font-medium">التاريخ</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
              <th className="px-3 py-2 text-center font-medium">PDF</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-primary">{inv.name}</td>
                <td className="px-3 py-2 text-foreground">{inv.customer}</td>
                <td className="px-3 py-2 text-muted-foreground">{inv.posting_date}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{inv.grand_total?.toLocaleString()} {inv.currency ?? "OMR"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(inv.status)}`}>
                    {statusLabel(inv.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => onDownload(inv.name)}
                    className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                    title="تحميل PDF">
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceDetailCard({ inv, onDownload }: { inv: InvoiceDetail; onDownload: (name: string) => void }) {
  const statusColor = (s: string) => {
    if (s === "Paid") return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (s === "Unpaid") return "text-amber-600 bg-amber-50 border-amber-200";
    if (s === "Overdue") return "text-red-600 bg-red-50 border-red-200";
    return "text-gray-600 bg-gray-50 border-gray-200";
  };
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          <span className="font-semibold text-foreground">{inv.name}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onDownload(inv.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3 grid grid-cols-2 gap-3">
        <div><span className="text-muted-foreground text-xs">العميل</span><p className="font-medium text-foreground">{inv.customer}</p></div>
        <div><span className="text-muted-foreground text-xs">الحالة</span>
          <p><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${statusColor(inv.status)}`}>
            {{ Paid: "مدفوعة", Unpaid: "غير مدفوعة", Overdue: "متأخرة", Draft: "مسودة" }[inv.status] ?? inv.status}
          </span></p>
        </div>
        <div><span className="text-muted-foreground text-xs">تاريخ الفاتورة</span><p className="font-medium text-foreground">{inv.posting_date}</p></div>
        <div><span className="text-muted-foreground text-xs">الإجمالي</span><p className="font-bold text-foreground">{inv.grand_total?.toLocaleString()} {inv.currency ?? "OMR"}</p></div>
        {inv.outstanding_amount !== undefined && (
          <div><span className="text-muted-foreground text-xs">المبلغ المتبقي</span><p className="font-medium text-amber-600">{inv.outstanding_amount?.toLocaleString()} {inv.currency ?? "OMR"}</p></div>
        )}
      </div>
      {inv.items && inv.items.length > 0 && (
        <div className="border-t border-border">
          <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium bg-muted/30">الأصناف</div>
          <table className="w-full text-xs">
            <thead><tr className="bg-muted/20 text-muted-foreground">
              <th className="px-3 py-1.5 text-right">الصنف</th>
              <th className="px-3 py-1.5 text-right">الكمية</th>
              <th className="px-3 py-1.5 text-right">السعر</th>
              <th className="px-3 py-1.5 text-right">الإجمالي</th>
            </tr></thead>
            <tbody>
              {inv.items.map((item, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="px-3 py-1.5 text-foreground">{item.item_name || item.item_code}</td>
                  <td className="px-3 py-1.5">{item.qty}</td>
                  <td className="px-3 py-1.5">{item.rate?.toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-medium">{item.amount?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustomersTable({ customers }: { customers: Customer[] }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <Users className="w-4 h-4 text-blue-500" />
        <span className="font-semibold text-foreground">العملاء ({customers.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-right font-medium">الاسم</th>
            <th className="px-3 py-2 text-right font-medium">النوع</th>
            <th className="px-3 py-2 text-right font-medium">الهاتف</th>
            <th className="px-3 py-2 text-right font-medium">البريد</th>
          </tr></thead>
          <tbody>
            {customers.map((c, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium text-foreground">{c.customer_name || c.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{c.customer_type === "Company" ? "شركة" : "فرد"}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{c.mobile_no ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{c.email_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ItemsTable({ items }: { items: Item[] }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <Package className="w-4 h-4 text-violet-500" />
        <span className="font-semibold text-foreground">الأصناف ({items.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-right font-medium">الكود</th>
            <th className="px-3 py-2 text-right font-medium">الاسم</th>
            <th className="px-3 py-2 text-right font-medium">المجموعة</th>
            <th className="px-3 py-2 text-right font-medium">السعر</th>
          </tr></thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-mono text-xs text-primary">{item.name}</td>
                <td className="px-3 py-2 font-medium text-foreground">{item.item_name}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{item.item_group ?? "—"}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{item.standard_rate?.toLocaleString() ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: SalesReport }) {
  const periodLabel = { this_month: "هذا الشهر", last_month: "الشهر الماضي", this_year: "هذه السنة" }[report.period] ?? report.period;
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <TrendingUp className="w-4 h-4 text-emerald-500" />
        <span className="font-semibold text-foreground">تقرير المبيعات — {periodLabel}</span>
        <span className="text-xs text-muted-foreground mr-auto">{report.fromDate} → {report.toDate}</span>
      </div>
      <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
          <p className="text-xs text-blue-600 mb-1">إجمالي الفواتير</p>
          <p className="text-xl font-bold text-blue-700">{report.totalInvoices}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
          <p className="text-xs text-emerald-600 mb-1">الإيرادات الكلية</p>
          <p className="text-lg font-bold text-emerald-700">{report.totalRevenue?.toLocaleString()}</p>
        </div>
        <div className="bg-teal-50 rounded-lg p-2.5 text-center">
          <p className="text-xs text-teal-600 mb-1">المحصّل</p>
          <p className="text-lg font-bold text-teal-700">{report.paidRevenue?.toLocaleString()}</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-2.5 text-center">
          <p className="text-xs text-amber-600 mb-1">غير محصّل</p>
          <p className="text-lg font-bold text-amber-700">{report.unpaidRevenue?.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

function CreatedInvoiceCard({ inv, onDownload }: { inv: CreatedInvoice; onDownload: (name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden text-sm">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-emerald-200">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span className="font-semibold text-emerald-700">تم إنشاء الفاتورة بنجاح</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onDownload(inv.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3">
        <p className="text-emerald-800"><span className="font-medium">رقم الفاتورة:</span> <span className="font-mono font-bold">{inv.name}</span></p>
        <p className="text-emerald-700 text-xs mt-1">الفاتورة محفوظة كمسودة في Almoaser AI ERP. يمكنك اعتمادها من النظام أو أطلب مني اعتمادها.</p>
      </div>
    </div>
  );
}

// ─── Tool Result Renderer ─────────────────────────────────────────────────────
function ToolResultRenderer({ display, onDownload }: { display: string; onDownload: (name: string) => void }) {
  if (display.startsWith("__INVOICES__")) {
    try {
      const invoices = JSON.parse(display.replace("__INVOICES__", "")) as Invoice[];
      return <InvoicesTable invoices={invoices} onDownload={onDownload} />;
    } catch { return null; }
  }
  if (display.startsWith("__INVOICE_DETAIL__")) {
    try {
      const inv = JSON.parse(display.replace("__INVOICE_DETAIL__", "")) as InvoiceDetail;
      return <InvoiceDetailCard inv={inv} onDownload={onDownload} />;
    } catch { return null; }
  }
  if (display.startsWith("__CUSTOMERS__")) {
    try {
      const customers = JSON.parse(display.replace("__CUSTOMERS__", "")) as Customer[];
      return <CustomersTable customers={customers} />;
    } catch { return null; }
  }
  if (display.startsWith("__ITEMS__")) {
    try {
      const items = JSON.parse(display.replace("__ITEMS__", "")) as Item[];
      return <ItemsTable items={items} />;
    } catch { return null; }
  }
  if (display.startsWith("__REPORT__")) {
    try {
      const report = JSON.parse(display.replace("__REPORT__", "")) as SalesReport;
      return <ReportCard report={report} />;
    } catch { return null; }
  }
  if (display.startsWith("__INVOICE_CREATED__")) {
    try {
      const inv = JSON.parse(display.replace("__INVOICE_CREATED__", "")) as CreatedInvoice;
      return <CreatedInvoiceCard inv={inv} onDownload={onDownload} />;
    } catch { return null; }
  }
  return null;
}

// ─── Suggestions ──────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: FileText, text: "اعرض آخر 10 فواتير" },
  { icon: Users, text: "اعرض قائمة العملاء" },
  { icon: BarChart3, text: "تقرير مبيعات هذا الشهر" },
  { icon: Package, text: "ما هي الأصناف المتاحة؟" },
  { icon: FileText, text: "أنشئ فاتورة لعميل" },
  { icon: BarChart3, text: "تقرير مبيعات هذه السنة" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const DOC_TYPE_LABEL: Record<string, string> = {
  sales_invoice: "فاتورة مبيعات",
  purchase_invoice: "فاتورة مشتريات",
  receipt_voucher: "سند قبض",
  payment_voucher: "سند صرف",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.agent.chat.useMutation();
  const pdfMutation = trpc.agent.getInvoicePdf.useMutation();
  const transcribeMutation = trpc.agent.transcribeVoice.useMutation();
  const extractMutation = trpc.agent.extractDocument.useMutation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const downloadPdf = async (invoiceName: string) => {
    try {
      const result = await pdfMutation.mutateAsync({ invoiceName });
      const byteChars = atob(result.pdfBase64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = result.filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("تعذّر تحميل PDF — تحقق من صلاحيات الطباعة في Almoaser AI ERP");
    }
  };

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
      setMessages(prev => [...prev, {
        role: "assistant",
        content: result.reply,
        ts: Date.now(),
        toolResults: result.toolResults,
      }]);
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

  // ─── Voice input ────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 1500) { toast.error("التسجيل قصير جداً — اضغط الميكروفون وتحدث ثم اضغط إيقاف"); return; }
        setTranscribing(true);
        try {
          const base64 = await blobToBase64(blob);
          const result = await transcribeMutation.mutateAsync({ audioBase64: base64, mimeType });
          // ضع النص في خانة الإدخال ليراجعه المستخدم ثم أرسله مباشرة
          void send(result.text);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "تعذّر تحويل الصوت إلى نص");
        } finally {
          setTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("تعذّر الوصول إلى الميكروفون — تأكد من منح الإذن للمتصفح");
    }
  }, [transcribeMutation]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }, []);

  // ─── Document image upload (OCR) ────────────────────────────────────────────
  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("يرجى اختيار صورة (JPG أو PNG)"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("الصورة كبيرة جداً — الحد الأقصى 10 ميجابايت"); return; }
    setExtracting(true);
    setMessages(prev => [...prev, { role: "user", content: "📷 رفعتُ صورة مستند مالي — اقرأها واستخرج بياناتها", ts: Date.now() }]);
    try {
      const base64 = await blobToBase64(file);
      const { extracted } = await extractMutation.mutateAsync({ imageBase64: base64, mimeType: file.type });
      const label = DOC_TYPE_LABEL[extracted.doc_type] ?? extracted.doc_type;
      const itemsText = extracted.items.length
        ? extracted.items.map(it => `  - ${it.description} × ${it.qty} بسعر ${it.rate} = ${it.amount}`).join("\n")
        : "  (لا توجد بنود مفصلة)";
      const summary = [
        `قرأتُ المستند من الصورة. هذه البيانات المستخرجة — **راجعها وأكّد لي التسجيل**:`,
        ``,
        `- **نوع المستند**: ${label}`,
        `- **الطرف (عميل/مورد)**: ${extracted.party_name || "غير واضح"}`,
        extracted.invoice_number ? `- **رقم المستند في الصورة**: ${extracted.invoice_number}` : "",
        extracted.date ? `- **التاريخ**: ${extracted.date}` : "",
        `- **البنود**:\n${itemsText}`,
        extracted.vat_amount > 0 ? `- **الضريبة**: ${extracted.vat_amount}` : "",
        `- **الإجمالي**: ${extracted.total_amount}${extracted.currency ? " " + extracted.currency : ""}`,
        extracted.notes ? `- **ملاحظات**: ${extracted.notes}` : "",
        ``,
        `هل أسجّله في النظام؟ اكتب "نعم" للتسجيل، أو صحّح أي بيانات قبل التسجيل.`,
      ].filter(Boolean).join("\n");
      setMessages(prev => [...prev, { role: "assistant", content: summary, ts: Date.now() }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذّر قراءة الصورة";
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${msg}`, ts: Date.now() }]);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-6rem)] max-w-4xl mx-auto gap-3">
        {/* Header */}
       <div className="flex items-center justify-between shrink-0">
         <div className="flex items-center gap-3">
            <img
              src="/manus-storage/almoaser-icon-192_bc4dbf5e.png"
              alt="المعاصر AI"
              className="w-10 h-10 rounded-xl object-contain bg-white border border-border"
            />
           <div>
              <h1 className="text-lg font-bold text-foreground">المعاصر AI — المحاسب الذكي</h1>
             <p className="text-xs text-muted-foreground">متصل بـ Almoaser AI ERP · ينفذ العمليات مباشرة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              متصل
            </Badge>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground"
                onClick={() => setMessages([])}>
                <Trash2 className="w-3.5 h-3.5" /> مسح
              </Button>
            )}
          </div>
        </div>

        {/* Chat area */}
        <Card className="flex-1 overflow-hidden shadow-sm flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Welcome */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-bold text-foreground mb-1">مرحباً! أنا محاسب المعاصر الذكي</h2>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    أنفّذ طلباتك مباشرة على Almoaser AI ERP — أنشئ الفواتير والعملاء والأصناف، اجلب التقارير، وأعالج أي نقص تلقائياً.
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
                <div className={`flex-1 ${msg.role === "user" ? "flex justify-end" : ""}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
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
                  {/* Tool Results */}
                  {msg.toolResults && msg.toolResults.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {msg.toolResults.map((tr, j) => (
                        tr.display ? (
                          <ToolResultRenderer key={j} display={tr.display} onDownload={(name) => void downloadPdf(name)} />
                        ) : null
                      ))}
                    </div>
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
                  <span className="text-sm text-muted-foreground">الوكيل يتصل بـ Almoaser AI ERP...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 shrink-0">
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => void handleImageSelected(e)}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={chatMutation.isPending || extracting || recording}
                size="icon"
                variant="outline"
                className="h-11 w-11 shrink-0"
                title="ارفع صورة فاتورة أو سند قبض"
              >
                {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              </Button>
              <Button
                onClick={() => (recording ? stopRecording() : void startRecording())}
                disabled={chatMutation.isPending || transcribing || extracting}
                size="icon"
                variant={recording ? "destructive" : "outline"}
                className={`h-11 w-11 shrink-0 ${recording ? "animate-pulse" : ""}`}
                title={recording ? "إيقاف التسجيل وإرسال" : "تحدث مع الوكيل بالصوت"}
              >
                {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={recording ? "🎙️ جارٍ التسجيل... اضغط زر الإيقاف عند الانتهاء" : transcribing ? "جارٍ تحويل الصوت إلى نص..." : "اكتب أمرك أو تحدث بالصوت أو ارفع صورة فاتورة..."}
                className="flex-1 min-h-[44px] max-h-32 resize-none text-sm"
                rows={1}
                disabled={chatMutation.isPending || recording || transcribing}
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
              Enter للإرسال · 🎙️ تحدث بالصوت · 📷 ارفع صورة فاتورة/سند — الوكيل يفهم وينفذ مباشرة على Almoaser AI ERP
            </p>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
