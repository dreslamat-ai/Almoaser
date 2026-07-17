/**
 * ERPNext AI Agent — Function Calling Router
 * الوكيل يقرر أي أداة يستدعي، ينفذها مباشرة على ERPNext، ويعيد النتائج الفعلية.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ─── ERPNext Session Cache ────────────────────────────────────────────────────
let _sid: string | null = null;
let _sidExpiry = 0;

async function getSession(): Promise<string> {
  const now = Date.now();
  if (_sid && now < _sidExpiry) return _sid;
  const url = process.env.ERPNEXT_URL ?? "";
  const usr = process.env.ERPNEXT_USERNAME ?? "";
  const pwd = process.env.ERPNEXT_PASSWORD ?? "";
  if (!url || !usr || !pwd) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ERPNext credentials not configured" });
  const res = await fetch(`${url}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr, pwd }),
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ERPNext login failed: ${res.status}` });
  const cookie = res.headers.get("set-cookie") ?? "";
  const m = cookie.match(/sid=([^;]+)/);
  if (!m || m[1] === "Guest") throw new TRPCError({ code: "UNAUTHORIZED", message: "ERPNext login returned Guest session" });
  _sid = m[1];
  _sidExpiry = now + 6 * 60 * 60 * 1000;
  return _sid;
}

async function erpGET(path: string): Promise<unknown> {
  const url = process.env.ERPNEXT_URL ?? "";
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid}` } });
  if (res.status === 401 || res.status === 403) {
    _sid = null; _sidExpiry = 0;
    const sid2 = await getSession();
    const res2 = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid2}` } });
    if (!res2.ok) throw new Error(`ERPNext GET error ${res2.status}`);
    return res2.json();
  }
  if (!res.ok) throw new Error(`ERPNext GET error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function erpPOST(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = process.env.ERPNEXT_URL ?? "";
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json", "X-Frappe-CSRF-Token": "fetch" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ERPNext POST error ${res.status}: ${errText.slice(0, 300)}`);
  }
  return res.json();
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_invoices",
      description: "جلب قائمة فواتير المبيعات من ERPNext مع إمكانية الفلترة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الفواتير (افتراضي 10)" },
          status: { type: "string", enum: ["Paid", "Unpaid", "Overdue", "Draft", "Cancelled"], description: "فلترة حسب الحالة" },
          customer: { type: "string", description: "فلترة حسب اسم العميل" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_invoice_detail",
      description: "جلب تفاصيل فاتورة محددة بالكامل بما فيها الأصناف والمبالغ",
      parameters: {
        type: "object",
        properties: {
          invoice_name: { type: "string", description: "رقم الفاتورة مثل SINV-2024-00001" },
        },
        required: ["invoice_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_customers",
      description: "جلب قائمة العملاء من ERPNext",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد العملاء (افتراضي 20)" },
          search: { type: "string", description: "بحث باسم العميل" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_items",
      description: "جلب قائمة الأصناف والخدمات من ERPNext",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الأصناف (افتراضي 20)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_invoice",
      description: "إنشاء فاتورة مبيعات جديدة في ERPNext كمسودة",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string", description: "اسم العميل (name field في ERPNext)" },
          items: {
            type: "array",
            description: "قائمة الأصناف",
            items: {
              type: "object",
              properties: {
                item_code: { type: "string", description: "كود الصنف" },
                qty: { type: "number", description: "الكمية" },
                rate: { type: "number", description: "السعر" },
              },
              required: ["item_code", "qty", "rate"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "تاريخ الاستحقاق بصيغة YYYY-MM-DD (اختياري)" },
        },
        required: ["customer", "items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_sales_report",
      description: "جلب تقرير ملخص المبيعات والإيرادات لفترة زمنية",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["this_month", "last_month", "this_year"], description: "الفترة الزمنية" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown; display: string }> {
  switch (name) {
    case "get_invoices": {
      const limit = (args.limit as number) ?? 10;
      const fields = encodeURIComponent(JSON.stringify(["name", "customer", "posting_date", "due_date", "grand_total", "outstanding_amount", "status", "currency"]));
      let filterStr = "";
      if (args.status) filterStr = `&filters=${encodeURIComponent(JSON.stringify([["status", "=", args.status]]))}`;
      else if (args.customer) filterStr = `&filters=${encodeURIComponent(JSON.stringify([["customer", "like", `%${args.customer}%`]]))}`;
      const data = await erpGET(`/api/resource/Sales%20Invoice?limit=${limit}&fields=${fields}&order_by=posting_date%20desc${filterStr}`) as { data: unknown[] };
      const invoices = data?.data ?? [];
      return { result: invoices, display: `__INVOICES__${JSON.stringify(invoices)}` };
    }
    case "get_invoice_detail": {
      const invName = encodeURIComponent(args.invoice_name as string);
      const data = await erpGET(`/api/resource/Sales%20Invoice/${invName}`) as { data: unknown };
      return { result: data?.data, display: `__INVOICE_DETAIL__${JSON.stringify(data?.data)}` };
    }
    case "get_customers": {
      const limit = (args.limit as number) ?? 20;
      const fields = encodeURIComponent(JSON.stringify(["name", "customer_name", "customer_type", "mobile_no", "email_id"]));
      let path = `/api/resource/Customer?limit=${limit}&fields=${fields}`;
      if (args.search) path += `&filters=${encodeURIComponent(JSON.stringify([["customer_name", "like", `%${args.search}%`]]))}`;
      const data = await erpGET(path) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__CUSTOMERS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "get_items": {
      const limit = (args.limit as number) ?? 20;
      const fields = encodeURIComponent(JSON.stringify(["name", "item_name", "item_group", "standard_rate", "stock_uom"]));
      const data = await erpGET(`/api/resource/Item?limit=${limit}&fields=${fields}`) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__ITEMS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_invoice": {
      const today = new Date().toISOString().split("T")[0];
      const invoiceDoc = {
        customer: args.customer,
        posting_date: today,
        due_date: (args.due_date as string) ?? today,
        items: (args.items as Array<{ item_code: string; qty: number; rate: number }>).map(i => ({
          item_code: i.item_code,
          qty: i.qty,
          rate: i.rate,
          amount: i.qty * i.rate,
        })),
      };
      const data = await erpPOST("/api/resource/Sales%20Invoice", invoiceDoc) as { data: { name: string; grand_total: number } };
      const invoiceName = data?.data?.name ?? "SINV-???";
      return {
        result: data?.data,
        display: `__INVOICE_CREATED__${JSON.stringify({ name: invoiceName, customer: args.customer, items: args.items, grand_total: data?.data?.grand_total })}`,
      };
    }
    case "get_sales_report": {
      const now = new Date();
      let fromDate: string, toDate: string;
      if (args.period === "last_month") {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        fromDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        toDate = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-${new Date(now.getFullYear(), now.getMonth(), 0).getDate()}`;
      } else if (args.period === "this_year") {
        fromDate = `${now.getFullYear()}-01-01`;
        toDate = `${now.getFullYear()}-12-31`;
      } else {
        fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        toDate = now.toISOString().split("T")[0];
      }
      const fields = encodeURIComponent(JSON.stringify(["name", "customer", "grand_total", "status", "posting_date"]));
      const filters = encodeURIComponent(JSON.stringify([["posting_date", ">=", fromDate], ["posting_date", "<=", toDate], ["docstatus", "=", 1]]));
      const data = await erpGET(`/api/resource/Sales%20Invoice?limit=200&fields=${fields}&filters=${filters}`) as { data: Array<{ grand_total: number; status: string }> };
      const invoices = data?.data ?? [];
      const total = invoices.reduce((s, i) => s + (i.grand_total ?? 0), 0);
      const paid = invoices.filter(i => i.status === "Paid").reduce((s, i) => s + (i.grand_total ?? 0), 0);
      const report = { period: (args.period as string) ?? "this_month", fromDate, toDate, totalInvoices: invoices.length, totalRevenue: total, paidRevenue: paid, unpaidRevenue: total - paid };
      return { result: report, display: `__REPORT__${JSON.stringify(report)}` };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Agent Router ─────────────────────────────────────────────────────────────
export const agentRouter = router({
  chat: protectedProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(["user", "assistant", "tool"]),
        content: z.string(),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        })).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const SYSTEM = `أنت وكيل ERPNext ذكي ومتخصص. تعمل مع نظام Almoaser AI Powered ERP.
مهمتك: تنفيذ طلبات المستخدم الفعلية على ERPNext — لا تعطِ إجابات عامة أبداً.

قواعد:
1. عند أي طلب يتعلق بفواتير/عملاء/أصناف/تقارير → استدعِ الأداة المناسبة فوراً
2. لا تقل "لا أستطيع" — إذا كان لديك أداة تنفذ الطلب، استخدمها
3. بعد تنفيذ الأداة، لخّص النتائج بوضوح بالعربية
4. عند إنشاء فاتورة: تأكد من وجود اسم العميل وكود الصنف والكمية والسعر قبل الاستدعاء
5. "استرجع فاتورة" أو "اعرض فاتورة" → استخدم get_invoice_detail أو get_invoices
6. كن مختصراً ومباشراً`;

      const llmMessages: Array<{
        role: "system" | "user" | "assistant" | "tool";
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
      }> = [
        { role: "system", content: SYSTEM },
        ...input.messages.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
      ];

      const toolResults: Array<{ tool_call_id: string; tool_name: string; display: string }> = [];

      for (let iter = 0; iter < 5; iter++) {
        const response = await invokeLLM({
          messages: llmMessages,
          tools: TOOLS,
          tool_choice: "auto",
          maxTokens: 2000,
        });

        const msg = response.choices[0]?.message;
        if (!msg) break;

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          const replyText = typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("")
              : "";
          return { reply: replyText, toolResults };
        }

        llmMessages.push({
          role: "assistant" as const,
          content: "",
          tool_calls: msg.tool_calls.map((tc: { id: string; function: { name: string; arguments: string } }) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        for (const tc of msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>) {
          let toolResult: string;
          let displayData = "";
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const { result, display } = await executeTool(tc.function.name, args);
            toolResult = JSON.stringify(result);
            displayData = display;
          } catch (e) {
            toolResult = JSON.stringify({ error: e instanceof Error ? e.message : "Tool execution failed" });
          }
          toolResults.push({ tool_call_id: tc.id, tool_name: tc.function.name, display: displayData });
          llmMessages.push({ role: "tool", content: toolResult, tool_call_id: tc.id });
        }
      }

      return { reply: "تم تنفيذ الطلب.", toolResults };
    }),

  getInvoicePdf: protectedProcedure
    .input(z.object({ invoiceName: z.string() }))
    .mutation(async ({ input }) => {
      const erpUrl = process.env.ERPNEXT_URL ?? "";
      const sid = await getSession();
      const pdfUrl = `${erpUrl}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name=${encodeURIComponent(input.invoiceName)}&format=Standard&no_letterhead=0`;
      const res = await fetch(pdfUrl, { headers: { Cookie: `sid=${sid}` } });
      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PDF generation failed: ${res.status}` });
      }
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { pdfBase64: base64, filename: `${input.invoiceName}.pdf` };
    }),
});
