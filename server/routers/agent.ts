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
      description: "جلب قائمة العملاء أو البحث عن عميل بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي عميل جديد للتأكد من عدم وجوده مسبقاً",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد العملاء (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم العميل (جزء من الاسم يكفي)" },
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
      description: "جلب قائمة الأصناف والخدمات أو البحث عن صنف بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي صنف جديد للتأكد من عدم وجوده مسبقاً",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الأصناف (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم الصنف أو كوده (جزء من الاسم يكفي)" },
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
  {
    type: "function" as const,
    function: {
      name: "create_customer",
      description: "إنشاء عميل جديد. لا تستخدمها أبداً قبل البحث بـ get_customers والتأكد من عدم وجود العميل — الأداة نفسها ترفض الإنشاء إذا وُجد عميل مطابق أو مشابه وتعيد قائمة المرشحين",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "اسم العميل" },
          customer_type: { type: "string", enum: ["Company", "Individual"], description: "نوع العميل: شركة أو فرد (الافتراضي Company)" },
          mobile_no: { type: "string", description: "رقم الجوال (اختياري)" },
          email_id: { type: "string", description: "البريد الإلكتروني (اختياري)" },
        },
        required: ["customer_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_item",
      description: "إنشاء صنف/خدمة جديدة. لا تستخدمها أبداً قبل البحث بـ get_items والتأكد من عدم وجود الصنف — الأداة نفسها ترفض الإنشاء إذا وُجد صنف مطابق أو مشابه وتعيد قائمة المرشحين",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "اسم الصنف أو الخدمة" },
          item_code: { type: "string", description: "كود الصنف (اختياري — يُستخدم الاسم إذا لم يُحدد)" },
          standard_rate: { type: "number", description: "سعر البيع الافتراضي (اختياري)" },
          is_service: { type: "boolean", description: "true إذا كان خدمة (غير مخزنية)، false إذا كان منتجاً مخزنياً. الافتراضي true" },
          item_group: { type: "string", description: "مجموعة الصنف (اختياري — الافتراضي: All Item Groups)" },
        },
        required: ["item_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_invoice",
      description: "اعتماد فاتورة مبيعات (Submit) لتسجيلها رسمياً في الحسابات. تُستخدم بعد إنشاء الفاتورة أو عند طلب المستخدم اعتماد فاتورة مسودة",
      parameters: {
        type: "object",
        properties: {
          invoice_name: { type: "string", description: "رقم الفاتورة مثل ACC-SINV-2026-00001" },
        },
        required: ["invoice_name"],
        additionalProperties: false,
      },
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

// تطبيع النص العربي للمقارنة التقريبية (همزات، تاء مربوطة، ألف مقصورة، تشكيل، مسافات)
function normalizeArabic(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSimilar(a: string, b: string): boolean {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// البحث عن عملاء مطابقين/مشابهين بالاسم
async function findSimilarCustomers(name: string): Promise<Array<{ name: string; customer_name: string }>> {
  const fields = encodeURIComponent(JSON.stringify(["name", "customer_name"]));
  // بحث like بأول كلمة من الاسم لتوسيع النتائج، ثم فلترة تقريبية محلياً
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  const filters = encodeURIComponent(JSON.stringify([["customer_name", "like", `%${firstWord}%`]]));
  const data = await erpGET(`/api/resource/Customer?limit=50&fields=${fields}&filters=${filters}`) as { data?: Array<{ name: string; customer_name: string }> };
  const all = data?.data ?? [];
  return all.filter(c => isSimilar(c.customer_name, name) || isSimilar(c.name, name));
}

// البحث عن أصناف مطابقة/مشابهة بالاسم أو الكود
async function findSimilarItems(name: string): Promise<Array<{ name: string; item_name: string; standard_rate?: number }>> {
  const fields = encodeURIComponent(JSON.stringify(["name", "item_name", "standard_rate"]));
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  const filters = encodeURIComponent(JSON.stringify([["item_name", "like", `%${firstWord}%`]]));
  const data = await erpGET(`/api/resource/Item?limit=50&fields=${fields}&filters=${filters}`) as { data?: Array<{ name: string; item_name: string; standard_rate?: number }> };
  const all = data?.data ?? [];
  return all.filter(i => isSimilar(i.item_name, name) || isSimilar(i.name, name));
}

// ترجمة أخطاء ERPNext الشائعة إلى رسائل عربية مفهومة
function translateErpError(raw: string): string {
  if (/LinkValidationError|Could not find/i.test(raw)) {
    const m = raw.match(/Could not find ([^:]+): ([^"\\,}]+)/i);
    if (m) return `السجل المرتبط غير موجود: ${m[1]} "${m[2]}" — ابحث عنه أولاً أو أنشئه ثم أعد المحاولة`;
    return "أحد السجلات المرتبطة (عميل/صنف/حساب) غير موجود في النظام";
  }
  if (/DuplicateEntryError|already exists/i.test(raw)) return "السجل موجود مسبقاً — استخدم الموجود بدلاً من إنشاء نسخة مكررة";
  if (/MandatoryError|is mandatory/i.test(raw)) return "حقل إلزامي ناقص: " + raw.slice(0, 200);
  if (/PermissionError|not permitted/i.test(raw)) return "صلاحيات غير كافية لتنفيذ هذه العملية في ERPNext";
  if (/ValidationError/i.test(raw)) return "خطأ تحقق من ERPNext: " + raw.slice(0, 200);
  return raw.slice(0, 300);
}

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
      let path = `/api/resource/Item?limit=${limit}&fields=${fields}`;
      if (args.search) path += `&filters=${encodeURIComponent(JSON.stringify([["item_name", "like", `%${args.search}%`]]))}`;
      const data = await erpGET(path) as { data: unknown[] };
      // إذا كان بحثاً ولم يجد نتائج like، جرّب البحث التقريبي المعرَّب
      if (args.search && (!data?.data || data.data.length === 0)) {
        const similar = await findSimilarItems(args.search as string);
        if (similar.length > 0) return { result: similar, display: `__ITEMS__${JSON.stringify(similar)}` };
      }
      return { result: data?.data ?? [], display: `__ITEMS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_invoice": {
      // حماية: تأكد من وجود العميل، وإن وُجد مشابه استخدمه تلقائياً
      const customerName = args.customer as string;
      const custMatches = await findSimilarCustomers(customerName);
      const exactCust = custMatches.find(c => normalizeArabic(c.customer_name) === normalizeArabic(customerName) || c.name === customerName);
      let resolvedCustomer = exactCust?.name ?? null;
      if (!resolvedCustomer && custMatches.length === 1) resolvedCustomer = custMatches[0].name;
      if (!resolvedCustomer && custMatches.length > 1) {
        return {
          result: { needs_clarification: true, reason: "found_multiple_customers", candidates: custMatches.map(c => c.customer_name) },
          display: "",
        };
      }
      if (!resolvedCustomer) {
        return {
          result: { error: `العميل "${customerName}" غير موجود في النظام. أنشئه أولاً بـ create_customer ثم أعد إنشاء الفاتورة` },
          display: "",
        };
      }
      // حماية: حل أكواد الأصناف — استخدم الموجود إن وُجد مشابه
      const rawItems = args.items as Array<{ item_code: string; qty: number; rate: number }>;
      const resolvedItems: Array<{ item_code: string; qty: number; rate: number }> = [];
      for (const it of rawItems) {
        const itemMatches = await findSimilarItems(it.item_code);
        const exactItem = itemMatches.find(i => normalizeArabic(i.item_name) === normalizeArabic(it.item_code) || i.name === it.item_code);
        const resolved = exactItem?.name ?? (itemMatches.length === 1 ? itemMatches[0].name : null);
        if (!resolved) {
          if (itemMatches.length > 1) {
            return {
              result: { needs_clarification: true, reason: "found_multiple_items", searched: it.item_code, candidates: itemMatches.map(i => i.item_name) },
              display: "",
            };
          }
          return {
            result: { error: `الصنف "${it.item_code}" غير موجود في النظام. أنشئه أولاً بـ create_item ثم أعد إنشاء الفاتورة` },
            display: "",
          };
        }
        resolvedItems.push({ item_code: resolved, qty: it.qty, rate: it.rate });
      }
      const today = new Date().toISOString().split("T")[0];
      const invoiceDoc = {
        customer: resolvedCustomer,
        posting_date: today,
        due_date: (args.due_date as string) ?? today,
        items: resolvedItems.map(i => ({
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
        display: `__INVOICE_CREATED__${JSON.stringify({ name: invoiceName, customer: resolvedCustomer, items: resolvedItems, grand_total: data?.data?.grand_total })}`,
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
    case "create_customer": {
      // منع التكرار: ابحث عن عميل مطابق أو مشابه أولاً
      const newName = args.customer_name as string;
      const existing = await findSimilarCustomers(newName);
      if (existing.length > 0) {
        return {
          result: {
            duplicate_prevented: true,
            message: `يوجد ${existing.length} عميل مشابه بالفعل — استخدم الموجود بدلاً من الإنشاء`,
            candidates: existing.map(c => ({ name: c.name, customer_name: c.customer_name })),
          },
          display: "",
        };
      }
      // جلب المجموعة والإقليم الجذر ديناميكياً (قد تكون أسماؤها معرّبة)
      const cgData = await erpGET(`/api/resource/Customer%20Group?limit=1&filters=${encodeURIComponent(JSON.stringify([["is_group", "=", 1]]))}`) as { data: Array<{ name: string }> };
      const terData = await erpGET(`/api/resource/Territory?limit=1&filters=${encodeURIComponent(JSON.stringify([["is_group", "=", 1]]))}`) as { data: Array<{ name: string }> };
      const customerDoc = {
        customer_name: args.customer_name,
        customer_type: (args.customer_type as string) ?? "Company",
        customer_group: cgData?.data?.[0]?.name ?? "All Customer Groups",
        territory: terData?.data?.[0]?.name ?? "All Territories",
        ...(args.mobile_no ? { mobile_no: args.mobile_no } : {}),
        ...(args.email_id ? { email_id: args.email_id } : {}),
      };
      const data = await erpPOST("/api/resource/Customer", customerDoc) as { data: { name: string; customer_name: string; customer_type: string } };
      return {
        result: data?.data,
        display: `__CUSTOMER_CREATED__${JSON.stringify({ name: data?.data?.name, customer_name: data?.data?.customer_name, customer_type: data?.data?.customer_type })}`,
      };
    }
    case "create_item": {
      // منع التكرار: ابحث عن صنف مطابق أو مشابه أولاً
      const newItemName = args.item_name as string;
      const existingItems = await findSimilarItems(newItemName);
      if (existingItems.length > 0) {
        return {
          result: {
            duplicate_prevented: true,
            message: `يوجد ${existingItems.length} صنف مشابه بالفعل — استخدم الموجود بدلاً من الإنشاء`,
            candidates: existingItems.map(i => ({ name: i.name, item_name: i.item_name, standard_rate: i.standard_rate })),
          },
          display: "",
        };
      }
      const isService = (args.is_service as boolean) ?? true;
      // جلب مجموعة الأصناف الجذر ووحدة القياس ديناميكياً
      const igData = await erpGET(`/api/resource/Item%20Group?limit=1&filters=${encodeURIComponent(JSON.stringify([["is_group", "=", 1]]))}`) as { data: Array<{ name: string }> };
      const uomData = await erpGET(`/api/resource/UOM?limit=1`) as { data: Array<{ name: string }> };
      const itemDoc = {
        item_code: (args.item_code as string) ?? (args.item_name as string),
        item_name: args.item_name,
        item_group: (args.item_group as string) ?? igData?.data?.[0]?.name ?? "All Item Groups",
        stock_uom: uomData?.data?.[0]?.name ?? "Nos",
        is_stock_item: isService ? 0 : 1,
        ...(args.standard_rate ? { standard_rate: args.standard_rate } : {}),
      };
      const data = await erpPOST("/api/resource/Item", itemDoc) as { data: { name: string; item_name: string; standard_rate: number; is_stock_item: number } };
      return {
        result: data?.data,
        display: `__ITEM_CREATED__${JSON.stringify({ name: data?.data?.name, item_name: data?.data?.item_name, standard_rate: data?.data?.standard_rate, is_stock_item: data?.data?.is_stock_item })}`,
      };
    }
    case "submit_invoice": {
      const invName = args.invoice_name as string;
      // Frappe submit: PUT with docstatus=1
      const url = process.env.ERPNEXT_URL ?? "";
      const sid = await getSession();
      const res = await fetch(`${url}/api/resource/Sales%20Invoice/${encodeURIComponent(invName)}`, {
        method: "PUT",
        headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json" },
        body: JSON.stringify({ docstatus: 1 }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`فشل اعتماد الفاتورة: ${errText.slice(0, 300)}`);
      }
      const data = await res.json() as { data: { name: string; status: string; grand_total: number } };
      return {
        result: data?.data,
        display: `__INVOICE_SUBMITTED__${JSON.stringify({ name: data?.data?.name, status: data?.data?.status, grand_total: data?.data?.grand_total })}`,
      };
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
      const SYSTEM = `أنت محاسب قانوني خبير ومساعد ذكاء اصطناعي متخصص في نظام Almoaser AI ERP (المبني على Frappe). اسمك "المعاصر AI".

## هويتك المهنية
لديك خبرة 15 عاماً في المحاسبة المالية والإدارية، وأنت خبير معتمد في Almoaser AI ERP. تتقن:
- معايير المحاسبة الدولية (IFRS) والمحاسبة العربية
- دورة حياة المستندات (Draft → Submitted → Cancelled)
- جميع DocTypes الرئيسية: Sales Invoice, Purchase Invoice, Journal Entry, Payment Entry, Customer, Supplier, Item, Account, Stock Entry
- مبدأ القيد المزدوج (Double Entry): كل عملية لها مدين ودائن متساويان
- الميزانية العمومية، قائمة الدخل، التدفقات النقدية، ميزان المراجعة
- ضريبة القيمة المضافة (VAT) وأحكامها في دول الخليج
- إدارة المخزون بطرق FIFO وWeighted Average
- مراكز التكلفة (Cost Centers) وإدارة المشاريع

## قواعد العمل الأساسية
1. **نفّذ أولاً، اشرح ثانياً**: عند أي طلب يتعلق بفواتير/عملاء/أصناف/تقارير → استدعِ الأداة المناسبة فوراً ثم علّق على النتائج
2. **لا تعطِ إجابات نظرية**: إذا كان لديك أداة تنفذ الطلب، استخدمها مباشرة
3. **بعد تنفيذ الأداة**: لخّص النتائج بأسلوب محاسب محترف — أبرز الأرقام المهمة، نبّه على المتأخرات، اقترح الإجراء التالي
4. **منع التكرار — القاعدة الذهبية (الأهم على الإطلاق)**:
   - **ممنوع منعاً باتاً** إنشاء عميل أو صنف دون البحث عنه أولاً
   - قبل أي create_customer → ابحث بـ get_customers(search) — إن وُجد مطابق أو مشابه → **استخدم الموجود** ولا تنشئ نسخة مكررة
   - قبل أي create_item → ابحث بـ get_items(search) — إن وُجد مطابق أو مشابه → **استخدم الموجود**
   - إن وُجدت عدة نتائج مشابهة → **اعرضها على المستخدم واسأله أيها يقصد** قبل المتابعة
   - فقط إذا لم تجد أي تطابق → أنشئ الجديد ثم أكمل العملية الأصلية
5. **سير إنشاء الفاتورة الصحيح**:
   أ. get_customers(search: اسم العميل) → موجود؟ استخدمه : مشابه متعدد؟ اسأل : غير موجود؟ create_customer
   ب. get_items(search: اسم الصنف) → موجود؟ استخدمه : مشابه متعدد؟ اسأل : غير موجود؟ create_item بسعر الفاتورة
   ج. create_invoice بالأسماء الفعلية (name) المُعادة من البحث
   د. إذا أعادت الأداة needs_clarification مع candidates → اعرض الخيارات على المستخدم واسأله
   هـ. إذا أعادت duplicate_prevented → استخدم السجل الموجود من candidates وأكمل مباشرة دون سؤال
6. **اسأل المستخدم فقط** عن بيانات لا يمكنك استنتاجها (المبلغ، الكمية إذا لم تُذكر) أو عند وجود عدة مرشحين مشابهين
7. **استرجاع فاتورة**: "اعرض فاتورة SINV-XXX" → get_invoice_detail | "آخر الفواتير" → get_invoices
8. **اللغة / Language**: ردّ دائماً بنفس لغة رسالة المستخدم الأخيرة. If the user writes in English, respond entirely in professional English with correct accounting terminology (Invoice, Journal Entry, Accounts Receivable, Trial Balance...). إذا كتب المستخدم بالعربية فردّ بعربية فصيحة مهنية بمصطلحات محاسبية صحيحة. Keep replies concise and professional in both languages
9. **الاعتماد**: بعد إنشاء الفاتورة اعرض اعتمادها — إن وافق المستخدم أو طلبها معتمدة → استدعِ submit_invoice
10. **الأرقام العربية**: حوّل الأرقام العربية (٦٥٠٠٠) إلى إنجليزية (65000) عند تمريرها للأدوات

## خبرتك في Almoaser AI ERP
- **Sales Invoice**: فاتورة المبيعات — تُنشأ Draft ثم Submit لتسجّل في الحسابات. الحالات: Draft/Unpaid/Paid/Overdue/Cancelled
- **Purchase Invoice**: فاتورة المشتريات من الموردين
- **Journal Entry**: قيد محاسبي يدوي — يستخدم للتسويات والتحويلات
- **Payment Entry**: تسجيل دفعة مستلمة أو مدفوعة
- **Customer**: العميل — له رصيد مديونية (AR) في الحسابات
- **Supplier**: المورد — له رصيد دائنية (AP)
- **Item**: الصنف أو الخدمة — له سعر بيع وتكلفة
- **Account**: حساب في شجرة الحسابات — مصنّف: أصول/خصوم/حقوق/إيرادات/مصروفات
- **Cost Center**: مركز تكلفة لتوزيع المصروفات
- **Fiscal Year**: السنة المالية — تحدد فترات التقارير

## أسلوب الرد بعد تنفيذ الأداة
- **للفواتير**: أذكر الإجمالي، عدد غير المدفوعة، أقدم متأخرة، واقترح المتابعة
- **للتقارير**: قارن بالفترة السابقة إذا أمكن، أبرز نسبة التحصيل
- **للعملاء**: نبّه على العملاء ذوي الأرصدة المرتفعة
- **لإنشاء فاتورة**: أكّد رقمها وتاريخها وإجماليها، ذكّر بضرورة الاعتماد (Submit) لتسجيلها في الحسابات
- **لإنشاء عميل/صنف**: أكّد الإنشاء واذكر التفاصيل، ثم أكمل العملية الأصلية إن وُجدت

## تاريخ اليوم
اليوم هو ${new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. استخدمه عند حساب التواريخ والفترات.`;

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

      for (let iter = 0; iter < 8; iter++) {
        let response;
        try {
          response = await invokeLLM({
            messages: llmMessages,
            tools: TOOLS,
            tool_choice: "auto",
            maxTokens: 2000,
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "LLM invocation failed";
          console.error("[agent.chat] invokeLLM error:", errMsg);
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذر الاتصال بالنموذج الذكي مؤقتاً — يرجى المحاولة مرة أخرى" });
        }

        const msg = response?.choices?.[0]?.message;
        if (!msg) {
          console.error("[agent.chat] empty LLM response:", JSON.stringify(response)?.slice(0, 500));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "أعاد النموذج الذكي استجابة فارغة — يرجى إعادة صياغة الطلب أو المحاولة مرة أخرى" });
        }

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
          tool_calls: msg.tool_calls.map((tc: { id?: string; index?: number; function: { name: string; arguments: string } }) => ({
            id: tc.id ?? `call_${tc.index ?? Math.random().toString(36).slice(2)}`,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        for (const tc of msg.tool_calls as Array<{ id?: string; index?: number; function: { name: string; arguments: string } }>) {
          const tcId = tc.id ?? `call_${tc.index ?? Math.random().toString(36).slice(2)}`;
          let toolResult: string;
          let displayData = "";
          try {
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const { result, display } = await executeTool(tc.function.name, args);
            toolResult = JSON.stringify(result);
            displayData = display;
          } catch (e) {
            const rawErr = e instanceof Error ? e.message : "Tool execution failed";
            console.error(`[agent.chat] tool ${tc.function.name} failed:`, rawErr);
            toolResult = JSON.stringify({ error: translateErpError(rawErr) });
          }
          toolResults.push({ tool_call_id: tcId, tool_name: tc.function.name, display: displayData });
          llmMessages.push({ role: "tool", content: toolResult, tool_call_id: tcId });
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
