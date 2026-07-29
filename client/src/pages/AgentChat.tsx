import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import NotificationBell from "@/components/NotificationBell";
import {
  Bot, Send, User, Sparkles, Loader2, Trash2,
  FileText, BarChart3, Users, Package, MessageSquare,
  Download, CheckCircle2, AlertCircle, TrendingUp,
  Mic, Square, ImagePlus, Camera,
  History, Plus, X, Volume2, VolumeX, Coins,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
type ToolResult = { tool_call_id: string; tool_name: string; display: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  ts: number;
  toolResults?: ToolResult[];
  quickReplies?: string[];
};

// ─── إشعار صوتي عند اكتمال رد الوكيل ─────────────────────────────────────────
const SOUND_PREF_KEY = "agent-chat-sound-enabled";

function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) !== "0";
  } catch { return true; }
}

// سياق صوتي مشترك يُنشأ/يُستأنف عند أول تفاعل مستخدم (سياسات autoplay في المتصفحات
// تمنع الصوت قبل أي إيماءة). استدعاء unlockAudio() من معالجات النقر/الإرسال يضمن
// أن النغمة اللاحقة — حتى غير المتزامنة — تعمل على كروم وسفاري والجوال.
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") sharedAudioCtx = new AC();
    return sharedAudioCtx;
  } catch { return null; }
}

// يُستدعى من داخل معالج تفاعل المستخدم (نقرة/إرسال) لفك قفل الصوت
function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => { /* fallback صامت */ });
}

// نغمة قصيرة لطيفة (نغمتان متصاعدتان) عبر Web Audio API — دون ملفات خارجية.
// إن ظل السياق موقوفاً (متصفح يمنع الصوت قبل تفاعل)، نتجاهل بصمت دون أخطاء.
function playReplyChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const start = () => {
      if (ctx.state !== "running") return; // fallback صامت — لا نغمة قبل أول تفاعل
      const now = ctx.currentTime;
      const notes: Array<{ freq: number; start: number; dur: number }> = [
        { freq: 880, start: 0, dur: 0.12 },       // A5
        { freq: 1318.5, start: 0.11, dur: 0.18 }, // E6
      ];
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = n.freq;
        gain.gain.setValueAtTime(0, now + n.start);
        gain.gain.linearRampToValueAtTime(0.12, now + n.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.05);
      }
    };
    if (ctx.state === "suspended") {
      // محاولة استئناف أخيرة ثم التشغيل إن نجحت
      void ctx.resume().then(start).catch(() => { /* fallback صامت */ });
    } else {
      start();
    }
  } catch { /* الصوت غير متاح — نتجاهل بصمت */ }
}

// تفكيك عمود toolResults المخزَّن: يدعم الصيغة القديمة (مصفوفة ToolResult[])
// والصيغة الجديدة (كائن { toolResults, quickReplies })
function parseStoredToolResults(raw: string | null | undefined): {
  toolResults?: ToolResult[];
  quickReplies?: string[];
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { toolResults: parsed as ToolResult[] };
    if (parsed && typeof parsed === "object") {
      const obj = parsed as { toolResults?: ToolResult[]; quickReplies?: string[] };
      return {
        toolResults: Array.isArray(obj.toolResults) ? obj.toolResults : undefined,
        quickReplies: Array.isArray(obj.quickReplies) ? obj.quickReplies : undefined,
      };
    }
  } catch { /* ignore */ }
  return {};
}

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

interface PurchaseInvoice {
  name: string;
  supplier: string;
  posting_date: string;
  due_date?: string;
  grand_total: number;
  outstanding_amount?: number;
  status: string;
  currency?: string;
}

interface Payment {
  name: string;
  payment_type?: string;
  party?: string;
  paid_amount: number;
  posting_date: string;
  status?: string;
  mode_of_payment?: string;
}

interface JournalEntryRow {
  name: string;
  posting_date: string;
  total_debit: number;
  total_credit?: number;
  user_remark?: string;
  docstatus?: number;
}

interface Customer {
  name: string;
  customer_name: string;
  customer_type?: string;
  mobile_no?: string;
  email_id?: string;
}

interface Supplier {
  name: string;
  supplier_name: string;
  supplier_type?: string;
  mobile_no?: string;
  email_id?: string;
}

interface Account {
  name: string;
  account_name: string;
  account_type?: string;
  root_type?: string;
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

type ErpDoctype = "Sales Invoice" | "Purchase Invoice" | "Payment Entry" | "Journal Entry";

interface CreatedPurchaseInvoice {
  name: string;
  supplier: unknown;
  items: unknown;
  grand_total?: number;
}

interface CreatedPayment {
  name: string;
  payment_type?: string;
  party?: string;
  paid_amount?: number;
}

interface CreatedJournalEntry {
  name: string;
  total_debit?: number;
  entries?: number;
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

function PurchaseInvoicesTable({ invoices, onDownload }: { invoices: PurchaseInvoice[]; onDownload: (doctype: ErpDoctype, name: string) => void }) {
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
        <span className="font-semibold text-foreground">فواتير المشتريات ({invoices.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-right font-medium">رقم الفاتورة</th>
              <th className="px-3 py-2 text-right font-medium">المورد</th>
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
                <td className="px-3 py-2 text-foreground">{inv.supplier}</td>
                <td className="px-3 py-2 text-muted-foreground">{inv.posting_date}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{inv.grand_total?.toLocaleString()} {inv.currency ?? ""}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(inv.status)}`}>
                    {statusLabel(inv.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => onDownload("Purchase Invoice", inv.name)}
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

function PaymentsTable({ payments, onDownload }: { payments: Payment[]; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <FileText className="w-4 h-4 text-primary" />
        <span className="font-semibold text-foreground">الدفعات ({payments.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-right font-medium">رقم السند</th>
              <th className="px-3 py-2 text-right font-medium">النوع</th>
              <th className="px-3 py-2 text-right font-medium">الطرف</th>
              <th className="px-3 py-2 text-right font-medium">التاريخ</th>
              <th className="px-3 py-2 text-right font-medium">المبلغ</th>
              <th className="px-3 py-2 text-right font-medium">طريقة الدفع</th>
              <th className="px-3 py-2 text-center font-medium">PDF</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-primary">{p.name}</td>
                <td className="px-3 py-2 text-foreground">{p.payment_type === "Receive" ? "قبض" : p.payment_type === "Pay" ? "صرف" : "—"}</td>
                <td className="px-3 py-2 text-foreground">{p.party ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.posting_date}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{p.paid_amount?.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{p.mode_of_payment ?? "—"}</td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => onDownload("Payment Entry", p.name)}
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

function JournalEntriesTable({ entries, onDownload }: { entries: JournalEntryRow[]; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <FileText className="w-4 h-4 text-primary" />
        <span className="font-semibold text-foreground">قيود اليومية ({entries.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/30 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-right font-medium">رقم القيد</th>
              <th className="px-3 py-2 text-right font-medium">التاريخ</th>
              <th className="px-3 py-2 text-right font-medium">إجمالي المدين</th>
              <th className="px-3 py-2 text-right font-medium">البيان</th>
              <th className="px-3 py-2 text-right font-medium">الحالة</th>
              <th className="px-3 py-2 text-center font-medium">PDF</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-primary">{e.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{e.posting_date}</td>
                <td className="px-3 py-2 font-semibold text-foreground">{e.total_debit?.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{e.user_remark ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${e.docstatus === 1 ? "bg-emerald-100 text-emerald-700" : e.docstatus === 2 ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"}`}>
                    {e.docstatus === 1 ? "معتمد" : e.docstatus === 2 ? "ملغى" : "مسودة"}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <button onClick={() => onDownload("Journal Entry", e.name)}
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

function SuppliersTable({ suppliers }: { suppliers: Supplier[] }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <Users className="w-4 h-4 text-blue-500" />
        <span className="font-semibold text-foreground">الموردون ({suppliers.length})</span>
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
            {suppliers.map((s, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium text-foreground">{s.supplier_name || s.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{s.supplier_type === "Individual" ? "فرد" : "شركة"}</td>
                <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{s.mobile_no ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{s.email_id ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROOT_TYPE_LABEL: Record<string, string> = {
  Asset: "أصول", Liability: "خصوم", Equity: "حقوق ملكية", Income: "إيرادات", Expense: "مصروفات",
};

function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <div className="mt-2 rounded-xl border border-border overflow-hidden text-sm">
      <div className="bg-muted/50 px-3 py-2 flex items-center gap-2 border-b border-border">
        <FileText className="w-4 h-4 text-primary" />
        <span className="font-semibold text-foreground">الحسابات ({accounts.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-muted/30 text-xs text-muted-foreground">
            <th className="px-3 py-2 text-right font-medium">اسم الحساب</th>
            <th className="px-3 py-2 text-right font-medium">التصنيف</th>
            <th className="px-3 py-2 text-right font-medium">النوع</th>
          </tr></thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={i} className="border-t border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2 font-medium text-foreground">{a.account_name || a.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.root_type ? (ROOT_TYPE_LABEL[a.root_type] ?? a.root_type) : "—"}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{a.account_type ?? "—"}</td>
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

function CreatedPurchaseInvoiceCard({ inv, onDownload }: { inv: CreatedPurchaseInvoice; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden text-sm">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-emerald-200">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span className="font-semibold text-emerald-700">تم إنشاء فاتورة المشتريات بنجاح</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onDownload("Purchase Invoice", inv.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3">
        <p className="text-emerald-800"><span className="font-medium">رقم الفاتورة:</span> <span className="font-mono font-bold">{inv.name}</span></p>
        <p className="text-emerald-700 text-xs mt-1">الفاتورة محفوظة كمسودة. يمكنك اعتمادها من النظام أو أطلب مني اعتمادها.</p>
      </div>
    </div>
  );
}

function CreatedPaymentCard({ inv, onDownload }: { inv: CreatedPayment; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden text-sm">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-emerald-200">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span className="font-semibold text-emerald-700">تم تسجيل الدفعة بنجاح</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onDownload("Payment Entry", inv.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3">
        <p className="text-emerald-800"><span className="font-medium">رقم السند:</span> <span className="font-mono font-bold">{inv.name}</span></p>
      </div>
    </div>
  );
}

function CreatedJournalEntryCard({ inv, onDownload }: { inv: CreatedJournalEntry; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden text-sm">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-emerald-200">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <span className="font-semibold text-emerald-700">تم تسجيل القيد اليومي بنجاح</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-auto border-emerald-300 text-emerald-700 hover:bg-emerald-100" onClick={() => onDownload("Journal Entry", inv.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3">
        <p className="text-emerald-800"><span className="font-medium">رقم القيد:</span> <span className="font-mono font-bold">{inv.name}</span></p>
      </div>
    </div>
  );
}

const DOCTYPE_LABEL: Record<ErpDoctype, string> = {
  "Sales Invoice": "فاتورة المبيعات",
  "Purchase Invoice": "فاتورة المشتريات",
  "Payment Entry": "الدفعة",
  "Journal Entry": "القيد اليومي",
};

function DocumentPrintCard({ doc, onDownload }: { doc: { doctype: ErpDoctype; name: string }; onDownload: (doctype: ErpDoctype, name: string) => void }) {
  return (
    <div className="mt-2 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden text-sm">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-primary/10">
        <FileText className="w-4 h-4 text-primary" />
        <span className="font-semibold text-foreground">{DOCTYPE_LABEL[doc.doctype] ?? doc.doctype} جاهزة للتحميل</span>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 mr-auto" onClick={() => onDownload(doc.doctype, doc.name)}>
          <Download className="w-3 h-3" /> تحميل PDF
        </Button>
      </div>
      <div className="p-3">
        <p className="text-foreground"><span className="font-medium">الرقم:</span> <span className="font-mono font-bold">{doc.name}</span></p>
      </div>
    </div>
  );
}

// ─── Tool Result Renderer ─────────────────────────────────────────────────────
function ToolResultRenderer({ display, onDownload, onDownloadDoc }: { display: string; onDownload: (name: string) => void; onDownloadDoc: (doctype: ErpDoctype, name: string) => void }) {
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
  if (display.startsWith("__PURCHASE_INVOICES__")) {
    try {
      const invoices = JSON.parse(display.replace("__PURCHASE_INVOICES__", "")) as PurchaseInvoice[];
      return <PurchaseInvoicesTable invoices={invoices} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__PAYMENTS__")) {
    try {
      const payments = JSON.parse(display.replace("__PAYMENTS__", "")) as Payment[];
      return <PaymentsTable payments={payments} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__JOURNAL_ENTRIES__")) {
    try {
      const entries = JSON.parse(display.replace("__JOURNAL_ENTRIES__", "")) as JournalEntryRow[];
      return <JournalEntriesTable entries={entries} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__CUSTOMERS__")) {
    try {
      const customers = JSON.parse(display.replace("__CUSTOMERS__", "")) as Customer[];
      return <CustomersTable customers={customers} />;
    } catch { return null; }
  }
  if (display.startsWith("__SUPPLIERS__")) {
    try {
      const suppliers = JSON.parse(display.replace("__SUPPLIERS__", "")) as Supplier[];
      return <SuppliersTable suppliers={suppliers} />;
    } catch { return null; }
  }
  if (display.startsWith("__ACCOUNTS__")) {
    try {
      const accounts = JSON.parse(display.replace("__ACCOUNTS__", "")) as Account[];
      return <AccountsTable accounts={accounts} />;
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
  if (display.startsWith("__PURCHASE_INVOICE_CREATED__")) {
    try {
      const inv = JSON.parse(display.replace("__PURCHASE_INVOICE_CREATED__", "")) as CreatedPurchaseInvoice;
      return <CreatedPurchaseInvoiceCard inv={inv} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__PAYMENT_CREATED__")) {
    try {
      const inv = JSON.parse(display.replace("__PAYMENT_CREATED__", "")) as CreatedPayment;
      return <CreatedPaymentCard inv={inv} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__JOURNAL_CREATED__")) {
    try {
      const inv = JSON.parse(display.replace("__JOURNAL_CREATED__", "")) as CreatedJournalEntry;
      return <CreatedJournalEntryCard inv={inv} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__DOCUMENT_PRINT__")) {
    try {
      const doc = JSON.parse(display.replace("__DOCUMENT_PRINT__", "")) as { doctype: ErpDoctype; name: string };
      return <DocumentPrintCard doc={doc} onDownload={onDownloadDoc} />;
    } catch { return null; }
  }
  if (display.startsWith("__CUSTOMER_CREATED__")) {
    try {
      const d = JSON.parse(display.replace("__CUSTOMER_CREATED__", "")) as { customer_name?: string; name: string; tax_id?: string };
      return (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">✅ تم إنشاء العميل</p>
          <p className="text-emerald-700 text-xs mt-1">{d.customer_name ?? d.name}{d.tax_id ? ` · الرقم الضريبي: ${d.tax_id}` : ""}</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__SUPPLIER_CREATED__")) {
    try {
      const d = JSON.parse(display.replace("__SUPPLIER_CREATED__", "")) as { supplier_name?: string; name: string };
      return (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">✅ تم إنشاء المورد</p>
          <p className="text-emerald-700 text-xs mt-1">{d.supplier_name ?? d.name}</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__ITEM_CREATED__")) {
    try {
      const d = JSON.parse(display.replace("__ITEM_CREATED__", "")) as { item_name?: string; name: string; standard_rate?: number };
      return (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">✅ تم إنشاء الصنف</p>
          <p className="text-emerald-700 text-xs mt-1">{d.item_name ?? d.name}{d.standard_rate ? ` · السعر: ${d.standard_rate.toLocaleString()}` : ""}</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__INVOICE_SUBMITTED__")) {
    try {
      const d = JSON.parse(display.replace("__INVOICE_SUBMITTED__", "")) as { name: string; status?: string; grand_total?: number };
      return (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">✅ تم اعتماد الفاتورة</p>
          <p className="text-emerald-700 text-xs mt-1">
            <span className="font-mono font-bold">{d.name}</span>
            {d.grand_total != null ? ` · الإجمالي: ${d.grand_total.toLocaleString()}` : ""} — سُجّلت رسمياً في الحسابات
          </p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__DOC_SUBMITTED__")) {
    try {
      const d = JSON.parse(display.replace("__DOC_SUBMITTED__", "")) as { doctype: string; name: string };
      return (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-800">✅ تم اعتماد المستند</p>
          <p className="text-emerald-700 text-xs mt-1">{d.doctype} — <span className="font-mono font-bold">{d.name}</span> — سُجّل رسمياً في الحسابات</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__SETTINGS_UPDATED__")) {
    try {
      const d = JSON.parse(display.replace("__SETTINGS_UPDATED__", "")) as { settings_type: string; name: string; changed: string[] };
      return (
        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
          <p className="font-semibold text-blue-800">⚙️ تم تحديث الإعدادات</p>
          <p className="text-blue-700 text-xs mt-1">{d.name}{d.changed?.length ? ` (الحقول: ${d.changed.join("، ")})` : ""}</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__DOC_UPDATED__")) {
    try {
      const d = JSON.parse(display.replace("__DOC_UPDATED__", "")) as { doctype: string; name: string; fields: string[] };
      return (
        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
          <p className="font-semibold text-blue-800">✏️ تم التعديل بنجاح</p>
          <p className="text-blue-700 text-xs mt-1">{d.doctype} — {d.name}{d.fields?.length ? ` (الحقول: ${d.fields.join("، ")})` : ""}</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__DOC_CANCELLED__")) {
    try {
      const d = JSON.parse(display.replace("__DOC_CANCELLED__", "")) as { doctype: string; name: string };
      return (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-800">🚫 تم إلغاء المستند</p>
          <p className="text-amber-700 text-xs mt-1">{d.doctype} — {d.name} (عُكس أثره من الحسابات)</p>
        </div>
      );
    } catch { return null; }
  }
  if (display.startsWith("__DOC_DELETED__")) {
    try {
      const d = JSON.parse(display.replace("__DOC_DELETED__", "")) as { doctype: string; name: string; cancelledFirst?: boolean };
      return (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-semibold text-red-800">🗑️ تم الحذف نهائياً</p>
          <p className="text-red-700 text-xs mt-1">{d.doctype} — {d.name}{d.cancelledFirst ? " (أُلغي أولاً ثم حُذف)" : ""}</p>
        </div>
      );
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
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<number | undefined>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingConvId, setLoadingConvId] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [pendingQuickReply, setPendingQuickReply] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isSoundEnabled());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.agent.chat.useMutation();
  const { data: creditsInfo } = trpc.credits.balance.useQuery();
  const pdfMutation = trpc.agent.getDocumentPdf.useMutation();
  const transcribeMutation = trpc.agent.transcribeVoice.useMutation();
  const extractMutation = trpc.agent.extractDocument.useMutation();
  const utils = trpc.useUtils();
  const conversationsQuery = trpc.agent.listConversations.useQuery(undefined, { enabled: historyOpen });
  const createConvMutation = trpc.agent.createConversation.useMutation();
  const deleteConvMutation = trpc.agent.deleteConversation.useMutation({
    onSuccess: () => { void utils.agent.listConversations.invalidate(); },
  });

  const startNewConversation = (createInDb = false) => {
    setMessages([]);
    setConversationId(undefined);
    setHistoryOpen(false);
    if (createInDb) {
      createConvMutation.mutate(undefined, {
        onSuccess: (data) => {
          setConversationId(data.conversationId);
          void utils.agent.listConversations.invalidate();
        },
      });
    }
  };

  const openConversation = async (id: number) => {
    if (loadingConvId) return;
    setLoadingConvId(id);
    try {
      const data = await utils.agent.getConversationMessages.fetch({ conversationId: id });
      setMessages(data.messages.map(m => {
        const stored = parseStoredToolResults(m.toolResults);
        return {
          role: m.role,
          content: m.content,
          ts: new Date(m.createdAt).getTime(),
          toolResults: stored.toolResults,
          quickReplies: stored.quickReplies,
        };
      }));
      setConversationId(id);
      setHistoryOpen(false);
    } catch {
      toast.error("تعذّر تحميل المحادثة");
    } finally {
      setLoadingConvId(null);
    }
  };

  const handleDeleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConvMutation.mutateAsync({ conversationId: id });
      if (conversationId === id) startNewConversation();
      toast.success("حُذفت المحادثة");
    } catch {
      toast.error("تعذّر حذف المحادثة");
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatMutation.isPending]);

  const downloadDocumentPdf = async (doctype: ErpDoctype, name: string) => {
    try {
      const result = await pdfMutation.mutateAsync({ doctype, name });
      const byteChars = atob(result.pdfBase64);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = result.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "تعذّر تحميل PDF — تحقق من صلاحيات الطباعة في Almoaser AI ERP");
    }
  };
  const downloadPdf = (invoiceName: string) => downloadDocumentPdf("Sales Invoice", invoiceName);

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      if (next) playReplyChime(); // معاينة فورية عند التفعيل
      return next;
    });
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || chatMutation.isPending) return;
    unlockAudio(); // فك قفل الصوت أثناء تفاعل المستخدم ليعمل الإشعار عند وصول الرد
    setInput("");
    const userMsg: Message = { role: "user", content, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    try {
      const result = await chatMutation.mutateAsync({
        conversationId,
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      });
      if (result.conversationId && result.conversationId !== conversationId) {
        setConversationId(result.conversationId);
      }
      setMessages(prev => [...prev, {
        role: "assistant",
        content: result.reply,
        ts: Date.now(),
        toolResults: result.toolResults,
        quickReplies: (result as { quickReplies?: string[] }).quickReplies,
      }]);
      if (isSoundEnabled()) playReplyChime();
      void utils.agent.listConversations.invalidate();
      void utils.credits.balance.invalidate();
    } catch (err) {
      const isOutOfCredits = err instanceof TRPCClientError && err.data?.code === "FORBIDDEN" && err.message.includes("رصيد النقاط");
      if (isOutOfCredits) {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `💳 **انتهى رصيد نقاطك الشهري**\n\n${err.message}\n\n[اشحن رصيدك الآن من صفحة الاشتراك ←](/subscription)`,
          ts: Date.now(),
        }]);
        toast.error("انتهى رصيد النقاط", {
          description: "اشحن رصيداً إضافياً لاستكمال المحادثة مع الوكيل الذكي",
          duration: 10000,
          action: { label: "اشحن الآن", onClick: () => navigate("/subscription") },
        });
      } else {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `⚠️ حدث خطأ: ${err instanceof Error ? err.message : "تعذّر الاتصال بالوكيل"}`,
          ts: Date.now(),
        }]);
      }
      void utils.credits.balance.invalidate();
    } finally {
      setPendingQuickReply(null);
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
            <NotificationBell />
            {creditsInfo && (() => {
              const low = creditsInfo.monthlyCredits > 0 && creditsInfo.balance / creditsInfo.monthlyCredits <= 0.15;
              return (
                <button
                  onClick={() => navigate("/subscription")}
                  title="رصيد النقاط — اضغط لإدارة الاشتراك"
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                    low ? "text-red-600 border-red-200 bg-red-50 hover:bg-red-100" : "text-gold-dark border-gold/30 bg-gold/10 hover:bg-gold/15"
                  }`}
                >
                  <Coins className="w-3.5 h-3.5" />
                  {creditsInfo.balance} <span className="opacity-60">/ {creditsInfo.monthlyCredits}</span>
                </button>
              );
            })()}
            <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-200 bg-emerald-50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              متصل
            </Badge>
            <Button variant="outline" size="sm" className="text-xs gap-1 px-2"
              onClick={toggleSound}
              title={soundEnabled ? "كتم صوت الإشعار" : "تفعيل صوت الإشعار"}>
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-muted-foreground" />}
            </Button>
            <Button variant="outline" size="sm" className="text-xs gap-1"
              onClick={() => setHistoryOpen(o => !o)}>
              <History className="w-3.5 h-3.5" /> السجل
            </Button>
            <Button variant="outline" size="sm" className="text-xs gap-1"
              onClick={() => startNewConversation(true)}
              disabled={createConvMutation.isPending}>
              <Plus className="w-3.5 h-3.5" /> محادثة جديدة
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground"
                onClick={() => startNewConversation()}>
                <Trash2 className="w-3.5 h-3.5" /> مسح
              </Button>
            )}
          </div>
        </div>

        {/* History panel */}
        {historyOpen && (
          <Card className="shrink-0 max-h-64 overflow-hidden flex flex-col shadow-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <History className="w-4 h-4 text-primary" /> المحادثات السابقة
              </div>
              <button onClick={() => setHistoryOpen(false)} className="p-1 rounded hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2 space-y-1">
              {conversationsQuery.isLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> جارٍ التحميل...
                </div>
              )}
              {!conversationsQuery.isLoading && (conversationsQuery.data?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد محادثات محفوظة بعد — ابدأ محادثة وستُحفظ تلقائياً</p>
              )}
              {conversationsQuery.data?.map(conv => (
                <div key={conv.id}
                  onClick={() => void openConversation(conv.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    conversationId === conv.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/60 border border-transparent"
                  }`}>
                  {loadingConvId === conv.id
                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                    : <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium text-foreground">{conv.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(conv.updatedAt).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  <button onClick={e => void handleDeleteConversation(conv.id, e)}
                    className="p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors shrink-0"
                    title="حذف المحادثة">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

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
                          <ToolResultRenderer key={j} display={tr.display} onDownload={(name) => void downloadPdf(name)} onDownloadDoc={(doctype, name) => void downloadDocumentPdf(doctype, name)} />
                        ) : null
                      ))}
                    </div>
                  )}
                  {/* Quick Replies — أزرار إجابات سريعة تظهر فقط تحت آخر رسالة من الوكيل */}
                  {msg.role === "assistant" &&
                    i === messages.length - 1 &&
                    msg.quickReplies && msg.quickReplies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                      {msg.quickReplies.map((qr, j) => (
                        <button
                          key={j}
                          onClick={() => { setPendingQuickReply(qr); void send(qr); }}
                          disabled={chatMutation.isPending}
                          className={`px-3.5 py-1.5 rounded-full border text-sm font-medium transition-all duration-150 inline-flex items-center gap-1.5 ${
                            pendingQuickReply === qr && chatMutation.isPending
                              ? "border-primary bg-primary text-primary-foreground cursor-wait"
                              : chatMutation.isPending
                                ? "border-border bg-muted/40 text-muted-foreground opacity-50 cursor-not-allowed"
                                : "border-primary/40 bg-primary/5 text-primary hover:bg-primary hover:text-primary-foreground active:scale-95"
                          }`}
                        >
                          {pendingQuickReply === qr && chatMutation.isPending && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          {qr}
                        </button>
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
                  <span className="text-sm text-muted-foreground">
                    {pendingQuickReply ? `جاري التنفيذ: «${pendingQuickReply}»...` : "جارٍ التحويل، لحظات من فضلك..."}
                  </span>
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
