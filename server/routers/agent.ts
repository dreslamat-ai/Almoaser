/**
 * ERPNext AI Agent — Function Calling Router
 * الوكيل يقرر أي أداة يستدعي، ينفذها مباشرة على ERPNext، ويعيد النتائج الفعلية.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { storagePut, storageGetSignedUrl } from "../storage";
import { transcribeAudio } from "../_core/voiceTranscription";
import { getErpConfigForUser, getErpSession, invalidateErpSession, type ErpConfig } from "../erpConnection";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ─── ERPNext Per-User Connection (AsyncLocalStorage) ─────────────────────────
// كل طلب يحمل إعدادات اتصال المستخدم (رابطه/مستخدمه/كلمة مروره) عبر سياق غير متزامن،
// فتعمل كل helpers (erpGET/erpPOST/submitDoc...) على نظام المستخدم دون تمرير config يدوياً
import { AsyncLocalStorage } from "async_hooks";
const erpContext = new AsyncLocalStorage<ErpConfig>();

export async function runWithErpConfig<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const config = await getErpConfigForUser(userId);
  return erpContext.run(config, fn);
}

function currentErpConfig(): ErpConfig {
  const cfg = erpContext.getStore();
  if (cfg) return cfg;
  // fallback (لا يحدث في المسار الطبيعي): اتصال النظام الافتراضي
  return {
    url: (process.env.ERPNEXT_URL ?? "").replace(/\/+$/, ""),
    username: process.env.ERPNEXT_USERNAME ?? "",
    password: process.env.ERPNEXT_PASSWORD ?? "",
    source: "system",
  };
}

async function getSession(): Promise<string> {
  return getErpSession(currentErpConfig());
}

function erpBaseUrl(): string {
  return currentErpConfig().url;
}

async function erpGET(path: string): Promise<unknown> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid}` } });
  if (res.status === 401 || res.status === 403) {
    invalidateErpSession(currentErpConfig());
    const sid2 = await getSession();
    const res2 = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid2}` } });
    if (!res2.ok) throw new Error(`ERPNext GET error ${res2.status}`);
    return res2.json();
  }
  if (!res.ok) throw new Error(`ERPNext GET error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function erpPOST(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = erpBaseUrl();
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

async function erpPUT(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "PUT",
    headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json", "X-Frappe-CSRF-Token": "fetch" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ERPNext PUT error ${res.status}: ${errText.slice(0, 300)}`);
  }
  return res.json();
}

async function erpDELETE(path: string): Promise<void> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "DELETE",
    headers: { Cookie: `sid=${sid}`, "X-Frappe-CSRF-Token": "fetch" },
  });
  if (!res.ok && res.status !== 202) {
    const errText = await res.text();
    throw new Error(`ERPNext DELETE error ${res.status}: ${errText.slice(0, 300)}`);
  }
}

/** إلغاء مستند معتمد (docstatus 1 → 2) عبر frappe.client.cancel */
async function cancelDoc(doctype: string, docName: string): Promise<{ name: string; docstatus?: number }> {
  const data = await erpPOST("/api/method/frappe.client.cancel", { doctype, name: docName }) as { message?: { name: string; docstatus?: number } };
  return data?.message ?? { name: docName };
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
  {
    type: "function" as const,
    function: {
      name: "get_suppliers",
      description: "جلب قائمة الموردين أو البحث عن مورد بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي مورد جديد",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الموردين (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_supplier",
      description: "إنشاء مورد جديد. لا تستخدمها قبل البحث بـ get_suppliers — الأداة ترفض الإنشاء إذا وُجد مورد مشابه وتعيد المرشحين",
      parameters: {
        type: "object",
        properties: {
          supplier_name: { type: "string", description: "اسم المورد" },
          supplier_type: { type: "string", enum: ["Company", "Individual"], description: "نوع المورد (الافتراضي Company)" },
          mobile_no: { type: "string", description: "رقم الجوال (اختياري)" },
          email_id: { type: "string", description: "البريد الإلكتروني (اختياري)" },
        },
        required: ["supplier_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_purchase_invoices",
      description: "جلب قائمة فواتير المشتريات مع إمكانية الفلترة بالحالة أو المورد",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الفواتير (افتراضي 10)" },
          status: { type: "string", enum: ["Paid", "Unpaid", "Overdue", "Draft", "Cancelled"], description: "فلترة حسب الحالة" },
          supplier: { type: "string", description: "فلترة حسب اسم المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_purchase_invoice",
      description: "إنشاء فاتورة مشتريات من مورد كمسودة. تحقق من وجود المورد والأصناف أولاً (get_suppliers/get_items) — الأداة تحل الأسماء المشابهة تلقائياً",
      parameters: {
        type: "object",
        properties: {
          supplier: { type: "string", description: "اسم المورد" },
          items: {
            type: "array",
            description: "قائمة الأصناف المشتراة",
            items: {
              type: "object",
              properties: {
                item_code: { type: "string", description: "كود أو اسم الصنف" },
                qty: { type: "number", description: "الكمية" },
                rate: { type: "number", description: "سعر الشراء" },
              },
              required: ["item_code", "qty", "rate"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "تاريخ الاستحقاق YYYY-MM-DD (اختياري)" },
        },
        required: ["supplier", "items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_payments",
      description: "جلب قائمة الدفعات (Payment Entries) المستلمة والمدفوعة مع إمكانية الفلترة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الدفعات (افتراضي 10)" },
          payment_type: { type: "string", enum: ["Receive", "Pay"], description: "Receive = مستلمة من عميل، Pay = مدفوعة لمورد" },
          party: { type: "string", description: "فلترة حسب اسم العميل أو المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_payment_entry",
      description: "تسجيل دفعة: مستلمة من عميل (Receive) أو مدفوعة لمورد (Pay). يمكن ربطها بفاتورة محددة لسدادها. تُنشأ كمسودة ثم تُعتمد بـ submit_document",
      parameters: {
        type: "object",
        properties: {
          payment_type: { type: "string", enum: ["Receive", "Pay"], description: "Receive = قبض من عميل، Pay = صرف لمورد" },
          party: { type: "string", description: "اسم العميل (لـ Receive) أو المورد (لـ Pay)" },
          amount: { type: "number", description: "مبلغ الدفعة" },
          reference_invoice: { type: "string", description: "رقم الفاتورة المراد سدادها مثل ACC-SINV-2026-00001 (اختياري — لربط الدفعة بالفاتورة)" },
          mode_of_payment: { type: "string", description: "طريقة الدفع مثل Cash أو Bank (اختياري)" },
        },
        required: ["payment_type", "party", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_accounts",
      description: "جلب شجرة الحسابات أو البحث عن حساب بالاسم — استخدمها قبل إنشاء قيد يومية لمعرفة أسماء الحسابات الفعلية",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "بحث باسم الحساب مثل Cash أو الصندوق أو المبيعات" },
          root_type: { type: "string", enum: ["Asset", "Liability", "Equity", "Income", "Expense"], description: "فلترة حسب التصنيف (اختياري)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_journal_entries",
      description: "جلب قيود اليومية المسجلة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد القيود (افتراضي 10)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_journal_entry",
      description: "تسجيل قيد يومية محاسبي (مدين/دائن). يجب أن يتساوى إجمالي المدين مع إجمالي الدائن. ابحث عن أسماء الحسابات الفعلية بـ get_accounts أولاً. يُنشأ كمسودة ثم يُعتمد بـ submit_document",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "سطور القيد — كل سطر حساب مع مبلغ مدين أو دائن",
            items: {
              type: "object",
              properties: {
                account: { type: "string", description: "اسم الحساب الفعلي من شجرة الحسابات" },
                debit: { type: "number", description: "المبلغ المدين (0 إذا كان السطر دائناً)" },
                credit: { type: "number", description: "المبلغ الدائن (0 إذا كان السطر مديناً)" },
              },
              required: ["account", "debit", "credit"],
              additionalProperties: false,
            },
          },
          remark: { type: "string", description: "البيان / وصف القيد" },
          posting_date: { type: "string", description: "تاريخ القيد YYYY-MM-DD (اختياري — الافتراضي اليوم)" },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_document",
      description: "اعتماد (Submit) أي مستند لتسجيله رسمياً في الحسابات: فاتورة مبيعات، فاتورة مشتريات، دفعة، أو قيد يومية",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", enum: ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"], description: "نوع المستند" },
          document_name: { type: "string", description: "رقم المستند مثل ACC-SINV-2026-00001 أو ACC-PAY-2026-00001" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_document",
      description: "تعديل أي مستند أو سجل في النظام: فاتورة (مسودة فقط)، عميل، مورد، صنف، قيد يومية (مسودة)، دفعة (مسودة). مرر الحقول المراد تغييرها فقط في fields. المستندات المعتمدة (docstatus=1) لا يمكن تعديلها — يجب إلغاؤها أولاً بـ cancel_document ثم إنشاء بديل، أما العملاء/الموردين/الأصناف فتُعدَّل مباشرة في أي وقت",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", enum: ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry", "Customer", "Supplier", "Item"], description: "نوع المستند أو السجل" },
          document_name: { type: "string", description: "معرّف المستند: رقم الفاتورة أو اسم العميل/المورد/الصنف كما هو في النظام" },
          fields: {
            type: "object",
            description: "الحقول المراد تعديلها بصيغة ERPNext، مثل: {\"customer_name\": \"الاسم الجديد\"} أو {\"mobile_no\": \"0555...\"} أو {\"standard_rate\": 150} أو {\"due_date\": \"2026-08-01\"}",
            additionalProperties: true,
          },
        },
        required: ["doctype", "document_name", "fields"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_document",
      description: "إلغاء (Cancel) مستند معتمد: فاتورة مبيعات/مشتريات، دفعة، أو قيد يومية. الإلغاء يعكس أثر المستند على الحسابات. مطلوب قبل حذف أي مستند معتمد",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", enum: ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"], description: "نوع المستند" },
          document_name: { type: "string", description: "رقم المستند المعتمد" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_document",
      description: "حذف نهائي لأي مستند أو سجل: فاتورة، عميل، مورد، صنف، قيد، دفعة. المستند المعتمد يُلغى تلقائياً أولاً ثم يُحذف. تحذير: الحذف نهائي ولا يمكن التراجع عنه — اطلب تأكيد المستخدم دائماً قبل التنفيذ",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", enum: ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry", "Customer", "Supplier", "Item"], description: "نوع المستند أو السجل" },
          document_name: { type: "string", description: "معرّف المستند المراد حذفه" },
        },
        required: ["doctype", "document_name"],
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

// توليد متغيرات الهمزات لكلمة البحث حتى يجد فلتر like في ERPNext الأسماء
// المكتوبة بهمزات مختلفة (اسلام/إسلام/أسلام كلها نفس الاسم)
function buildSearchVariants(word: string): string[] {
  const variants = new Set<string>();
  const add = (w: string) => { if (w) variants.add(w); };
  add(word);
  // توحيد كل الألفات إلى ألف مجردة كأساس
  const base = word.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  add(base);
  // متغيرات أول حرف إذا كان ألفاً بأي شكل
  if (/^[اأإآ]/.test(base)) {
    for (const alef of ["ا", "أ", "إ", "آ"]) add(alef + base.slice(1));
  }
  // متغيرات آخر حرف (ه/ة و ي/ى)
  const expanded = Array.from(variants);
  for (const v of expanded) {
    if (v.endsWith("ه")) add(v.slice(0, -1) + "ة");
    if (v.endsWith("ة")) add(v.slice(0, -1) + "ه");
    if (v.endsWith("ي")) add(v.slice(0, -1) + "ى");
    if (v.endsWith("ى")) add(v.slice(0, -1) + "ي");
  }
  return Array.from(variants).slice(0, 8);
}

// بحث like متعدد المتغيرات في ERPNext: يجرب كل متغير همزات ويدمج النتائج
async function erpSearchByField<T extends { name: string }>(
  doctype: string,
  searchField: string,
  query: string,
  fields: string[],
): Promise<T[]> {
  const firstWord = query.trim().split(/\s+/)[0] ?? query;
  const variants = buildSearchVariants(firstWord);
  const fieldsParam = encodeURIComponent(JSON.stringify(fields));
  const merged = new Map<string, T>();
  await Promise.all(variants.map(async v => {
    try {
      const filters = encodeURIComponent(JSON.stringify([[searchField, "like", `%${v}%`]]));
      const data = await erpGET(`/api/resource/${encodeURIComponent(doctype)}?limit=50&fields=${fieldsParam}&filters=${filters}`) as { data?: T[] };
      for (const row of data?.data ?? []) merged.set(row.name, row);
    } catch {
      // تجاهل فشل متغير واحد — بقية المتغيرات تكفي
    }
  }));
  return Array.from(merged.values());
}

// البحث عن عملاء مطابقين/مشابهين بالاسم
async function findSimilarCustomers(name: string): Promise<Array<{ name: string; customer_name: string }>> {
  // بحث like بكل متغيرات الهمزات لأول كلمة، ثم فلترة تقريبية محلياً
  const all = await erpSearchByField<{ name: string; customer_name: string }>(
    "Customer", "customer_name", name, ["name", "customer_name"],
  );
  return all.filter(c => isSimilar(c.customer_name, name) || isSimilar(c.name, name));
}

// البحث عن أصناف مطابقة/مشابهة بالاسم أو الكود
async function findSimilarItems(name: string): Promise<Array<{ name: string; item_name: string; standard_rate?: number }>> {
  const all = await erpSearchByField<{ name: string; item_name: string; standard_rate?: number }>(
    "Item", "item_name", name, ["name", "item_name", "standard_rate"],
  );
  return all.filter(i => isSimilar(i.item_name, name) || isSimilar(i.name, name));
}

// البحث عن موردين مطابقين/مشابهين بالاسم
async function findSimilarSuppliers(name: string): Promise<Array<{ name: string; supplier_name: string }>> {
  const all = await erpSearchByField<{ name: string; supplier_name: string }>(
    "Supplier", "supplier_name", name, ["name", "supplier_name"],
  );
  return all.filter(s => isSimilar(s.supplier_name, name) || isSimilar(s.name, name));
}

// اعتماد مستند عام (docstatus = 1)
async function submitDoc(doctype: string, docName: string): Promise<{ name: string; status?: string; grand_total?: number }> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(docName)}`, {
    method: "PUT",
    headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json" },
    body: JSON.stringify({ docstatus: 1 }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`فشل اعتماد المستند: ${errText.slice(0, 300)}`);
  }
  const data = await res.json() as { data: { name: string; status?: string; grand_total?: number } };
  return data?.data;
}

// جلب الشركة الافتراضية (مطلوبة للدفعات والقيود)
let _defaultCompany: string | null = null;
async function getDefaultCompany(): Promise<string> {
  if (_defaultCompany) return _defaultCompany;
  const data = await erpGET(`/api/resource/Company?limit=1&fields=${encodeURIComponent(JSON.stringify(["name"]))}`) as { data: Array<{ name: string }> };
  _defaultCompany = data?.data?.[0]?.name ?? "";
  if (!_defaultCompany) throw new Error("لا توجد شركة معرّفة في النظام");
  return _defaultCompany;
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
      // إذا كان بحثاً ولم يجد نتائج like، جرّب البحث التقريبي المعرَّب (كل أشكال الهمزات)
      if (args.search && (!data?.data || data.data.length === 0)) {
        const similar = await findSimilarCustomers(args.search as string);
        if (similar.length > 0) return { result: similar, display: `__CUSTOMERS__${JSON.stringify(similar)}` };
      }
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
      // due_date لا يجوز أن يسبق posting_date — إن كان التاريخ المُمرر أقدم (مثلاً من صورة فاتورة قديمة) استخدم اليوم
      const requestedDue = (args.due_date as string) ?? today;
      const safeDueDate = requestedDue < today ? today : requestedDue;
      const invoiceDoc = {
        customer: resolvedCustomer,
        posting_date: today,
        due_date: safeDueDate,
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
      const url = erpBaseUrl();
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
    case "get_suppliers": {
      const limit = (args.limit as number) ?? 20;
      const fields = encodeURIComponent(JSON.stringify(["name", "supplier_name", "supplier_type", "mobile_no", "email_id"]));
      let path = `/api/resource/Supplier?limit=${limit}&fields=${fields}`;
      if (args.search) path += `&filters=${encodeURIComponent(JSON.stringify([["supplier_name", "like", `%${args.search}%`]]))}`;
      const data = await erpGET(path) as { data: unknown[] };
      if (args.search && (!data?.data || data.data.length === 0)) {
        const similar = await findSimilarSuppliers(args.search as string);
        if (similar.length > 0) return { result: similar, display: `__SUPPLIERS__${JSON.stringify(similar)}` };
      }
      return { result: data?.data ?? [], display: `__SUPPLIERS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_supplier": {
      const newName = args.supplier_name as string;
      const existing = await findSimilarSuppliers(newName);
      if (existing.length > 0) {
        return {
          result: {
            duplicate_prevented: true,
            message: `يوجد ${existing.length} مورد مشابه بالفعل — استخدم الموجود بدلاً من الإنشاء`,
            candidates: existing.map(s => ({ name: s.name, supplier_name: s.supplier_name })),
          },
          display: "",
        };
      }
      const sgData = await erpGET(`/api/resource/Supplier%20Group?limit=1&filters=${encodeURIComponent(JSON.stringify([["is_group", "=", 1]]))}`) as { data: Array<{ name: string }> };
      const supplierDoc = {
        supplier_name: newName,
        supplier_type: (args.supplier_type as string) ?? "Company",
        supplier_group: sgData?.data?.[0]?.name ?? "All Supplier Groups",
        ...(args.mobile_no ? { mobile_no: args.mobile_no } : {}),
        ...(args.email_id ? { email_id: args.email_id } : {}),
      };
      const data = await erpPOST("/api/resource/Supplier", supplierDoc) as { data: { name: string; supplier_name: string; supplier_type: string } };
      return {
        result: data?.data,
        display: `__SUPPLIER_CREATED__${JSON.stringify({ name: data?.data?.name, supplier_name: data?.data?.supplier_name, supplier_type: data?.data?.supplier_type })}`,
      };
    }
    case "get_purchase_invoices": {
      const limit = (args.limit as number) ?? 10;
      const fields = encodeURIComponent(JSON.stringify(["name", "supplier", "posting_date", "due_date", "grand_total", "outstanding_amount", "status", "currency"]));
      let filterStr = "";
      if (args.status) filterStr = `&filters=${encodeURIComponent(JSON.stringify([["status", "=", args.status]]))}`;
      else if (args.supplier) filterStr = `&filters=${encodeURIComponent(JSON.stringify([["supplier", "like", `%${args.supplier}%`]]))}`;
      const data = await erpGET(`/api/resource/Purchase%20Invoice?limit=${limit}&fields=${fields}&order_by=posting_date%20desc${filterStr}`) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__PURCHASE_INVOICES__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_purchase_invoice": {
      const supplierName = args.supplier as string;
      const supMatches = await findSimilarSuppliers(supplierName);
      const exactSup = supMatches.find(s => normalizeArabic(s.supplier_name) === normalizeArabic(supplierName) || s.name === supplierName);
      let resolvedSupplier = exactSup?.name ?? null;
      if (!resolvedSupplier && supMatches.length === 1) resolvedSupplier = supMatches[0].name;
      if (!resolvedSupplier && supMatches.length > 1) {
        return {
          result: { needs_clarification: true, reason: "found_multiple_suppliers", candidates: supMatches.map(s => s.supplier_name) },
          display: "",
        };
      }
      if (!resolvedSupplier) {
        return {
          result: { error: `المورد "${supplierName}" غير موجود في النظام. أنشئه أولاً بـ create_supplier ثم أعد إنشاء الفاتورة` },
          display: "",
        };
      }
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
            result: { error: `الصنف "${it.item_code}" غير موجود. أنشئه أولاً بـ create_item ثم أعد إنشاء فاتورة المشتريات` },
            display: "",
          };
        }
        resolvedItems.push({ item_code: resolved, qty: it.qty, rate: it.rate });
      }
      const today = new Date().toISOString().split("T")[0];
      const requestedPiDue = (args.due_date as string) ?? today;
      const safePiDueDate = requestedPiDue < today ? today : requestedPiDue;
      const piDoc = {
        supplier: resolvedSupplier,
        posting_date: today,
        due_date: safePiDueDate,
        items: resolvedItems.map(i => ({ item_code: i.item_code, qty: i.qty, rate: i.rate, amount: i.qty * i.rate })),
      };
      const data = await erpPOST("/api/resource/Purchase%20Invoice", piDoc) as { data: { name: string; grand_total: number } };
      return {
        result: data?.data,
        display: `__PURCHASE_INVOICE_CREATED__${JSON.stringify({ name: data?.data?.name, supplier: resolvedSupplier, items: resolvedItems, grand_total: data?.data?.grand_total })}`,
      };
    }
    case "get_payments": {
      const limit = (args.limit as number) ?? 10;
      const fields = encodeURIComponent(JSON.stringify(["name", "payment_type", "party_type", "party", "paid_amount", "posting_date", "status", "mode_of_payment"]));
      const filters: Array<[string, string, string]> = [];
      if (args.payment_type) filters.push(["payment_type", "=", args.payment_type as string]);
      if (args.party) filters.push(["party", "like", `%${args.party}%`]);
      const filterStr = filters.length > 0 ? `&filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
      const data = await erpGET(`/api/resource/Payment%20Entry?limit=${limit}&fields=${fields}&order_by=posting_date%20desc${filterStr}`) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__PAYMENTS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_payment_entry": {
      const paymentType = args.payment_type as string; // Receive | Pay
      const partyName = args.party as string;
      const amount = args.amount as number;
      const partyType = paymentType === "Receive" ? "Customer" : "Supplier";
      // حل اسم الطرف
      let resolvedParty: string | null = null;
      if (partyType === "Customer") {
        const matches = await findSimilarCustomers(partyName);
        const exact = matches.find(c => normalizeArabic(c.customer_name) === normalizeArabic(partyName) || c.name === partyName);
        resolvedParty = exact?.name ?? (matches.length === 1 ? matches[0].name : null);
        if (!resolvedParty && matches.length > 1) {
          return { result: { needs_clarification: true, reason: "found_multiple_customers", candidates: matches.map(c => c.customer_name) }, display: "" };
        }
      } else {
        const matches = await findSimilarSuppliers(partyName);
        const exact = matches.find(s => normalizeArabic(s.supplier_name) === normalizeArabic(partyName) || s.name === partyName);
        resolvedParty = exact?.name ?? (matches.length === 1 ? matches[0].name : null);
        if (!resolvedParty && matches.length > 1) {
          return { result: { needs_clarification: true, reason: "found_multiple_suppliers", candidates: matches.map(s => s.supplier_name) }, display: "" };
        }
      }
      if (!resolvedParty) {
        return { result: { error: `${partyType === "Customer" ? "العميل" : "المورد"} "${partyName}" غير موجود في النظام` }, display: "" };
      }
      // استخدام الطريقة القياسية في Frappe لتجهيز دفعة مرتبطة بفاتورة
      const company = await getDefaultCompany();
      const today = new Date().toISOString().split("T")[0];
      const paymentDoc: Record<string, unknown> = {
        payment_type: paymentType,
        party_type: partyType,
        party: resolvedParty,
        company,
        posting_date: today,
        paid_amount: amount,
        received_amount: amount,
        ...(args.mode_of_payment ? { mode_of_payment: args.mode_of_payment } : {}),
      };
      // جلب الحسابات الافتراضية: حساب الطرف (مدينون/دائنون) وحساب النقد
      const companyData = await erpGET(`/api/resource/Company/${encodeURIComponent(company)}`) as { data: { default_receivable_account?: string; default_payable_account?: string; default_cash_account?: string; default_bank_account?: string } };
      const cd = companyData?.data ?? {};
      const cashAccount = cd.default_cash_account || cd.default_bank_account;
      if (paymentType === "Receive") {
        paymentDoc.paid_from = cd.default_receivable_account;
        paymentDoc.paid_to = cashAccount;
      } else {
        paymentDoc.paid_from = cashAccount;
        paymentDoc.paid_to = cd.default_payable_account;
      }
      if (!paymentDoc.paid_from || !paymentDoc.paid_to) {
        return { result: { error: "الحسابات الافتراضية (النقد/المدينون/الدائنون) غير معرّفة في إعدادات الشركة داخل النظام — يرجى ضبطها أولاً" }, display: "" };
      }
      // ربط بفاتورة محددة إن طُلب
      if (args.reference_invoice) {
        const refDoctype = paymentType === "Receive" ? "Sales Invoice" : "Purchase Invoice";
        paymentDoc.references = [{
          reference_doctype: refDoctype,
          reference_name: args.reference_invoice,
          allocated_amount: amount,
        }];
      }
      const data = await erpPOST("/api/resource/Payment%20Entry", paymentDoc) as { data: { name: string; paid_amount: number; payment_type: string; party: string } };
      return {
        result: data?.data,
        display: `__PAYMENT_CREATED__${JSON.stringify({ name: data?.data?.name, payment_type: data?.data?.payment_type, party: data?.data?.party, paid_amount: data?.data?.paid_amount })}`,
      };
    }
    case "get_accounts": {
      const fields = encodeURIComponent(JSON.stringify(["name", "account_name", "account_type", "root_type", "is_group"]));
      const filters: Array<[string, string, string | number]> = [["is_group", "=", 0]];
      if (args.search) filters.push(["account_name", "like", `%${args.search}%`]);
      if (args.root_type) filters.push(["root_type", "=", args.root_type as string]);
      const data = await erpGET(`/api/resource/Account?limit=50&fields=${fields}&filters=${encodeURIComponent(JSON.stringify(filters))}`) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__ACCOUNTS__${JSON.stringify(data?.data ?? [])}` };
    }
    case "get_journal_entries": {
      const limit = (args.limit as number) ?? 10;
      const fields = encodeURIComponent(JSON.stringify(["name", "posting_date", "total_debit", "total_credit", "user_remark", "docstatus"]));
      const data = await erpGET(`/api/resource/Journal%20Entry?limit=${limit}&fields=${fields}&order_by=posting_date%20desc`) as { data: unknown[] };
      return { result: data?.data ?? [], display: `__JOURNAL_ENTRIES__${JSON.stringify(data?.data ?? [])}` };
    }
    case "create_journal_entry": {
      const entries = args.entries as Array<{ account: string; debit: number; credit: number }>;
      const totalDebit = entries.reduce((s, e) => s + (e.debit ?? 0), 0);
      const totalCredit = entries.reduce((s, e) => s + (e.credit ?? 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.001) {
        return { result: { error: `القيد غير متوازن: إجمالي المدين ${totalDebit} ≠ إجمالي الدائن ${totalCredit} — يجب أن يتساويا` }, display: "" };
      }
      // حل أسماء الحسابات: بحث تقريبي عن كل حساب
      const resolvedEntries: Array<{ account: string; debit_in_account_currency: number; credit_in_account_currency: number }> = [];
      for (const e of entries) {
        const accFields = encodeURIComponent(JSON.stringify(["name", "account_name"]));
        const accFilters = encodeURIComponent(JSON.stringify([["is_group", "=", 0], ["account_name", "like", `%${e.account.trim().split(/\s+/)[0]}%`]]));
        const accData = await erpGET(`/api/resource/Account?limit=20&fields=${accFields}&filters=${accFilters}`) as { data: Array<{ name: string; account_name: string }> };
        const candidates = (accData?.data ?? []).filter(a => isSimilar(a.account_name, e.account) || isSimilar(a.name, e.account));
        // إذا كان الاسم الكامل (name) مطابقاً تماماً استخدمه مباشرة
        let resolvedAccount = e.account;
        if (candidates.length === 1) resolvedAccount = candidates[0].name;
        else if (candidates.length > 1) {
          const exact = candidates.find(a => normalizeArabic(a.account_name) === normalizeArabic(e.account));
          if (exact) resolvedAccount = exact.name;
          else return { result: { needs_clarification: true, reason: "found_multiple_accounts", searched: e.account, candidates: candidates.map(a => a.name) }, display: "" };
        } else if (candidates.length === 0) {
          // ربما مرر المستخدم الاسم الكامل بالفعل — جرّبه كما هو، وإلا سيُعاد خطأ مترجم
          resolvedAccount = e.account;
        }
        resolvedEntries.push({ account: resolvedAccount, debit_in_account_currency: e.debit ?? 0, credit_in_account_currency: e.credit ?? 0 });
      }
      const company = await getDefaultCompany();
      const jeDoc = {
        voucher_type: "Journal Entry",
        company,
        posting_date: (args.posting_date as string) ?? new Date().toISOString().split("T")[0],
        accounts: resolvedEntries,
        ...(args.remark ? { user_remark: args.remark } : {}),
      };
      const data = await erpPOST("/api/resource/Journal%20Entry", jeDoc) as { data: { name: string; total_debit: number } };
      return {
        result: data?.data,
        display: `__JOURNAL_CREATED__${JSON.stringify({ name: data?.data?.name, total_debit: data?.data?.total_debit, entries: resolvedEntries.length })}`,
      };
    }
    case "submit_document": {
      const doctype = args.doctype as string;
      const docName = args.document_name as string;
      const result = await submitDoc(doctype, docName);
      return {
        result,
        display: `__DOC_SUBMITTED__${JSON.stringify({ doctype, name: result?.name, status: result?.status })}`,
      };
    }
    case "update_document": {
      const doctype = args.doctype as string;
      const docName = args.document_name as string;
      const fields = args.fields as Record<string, unknown>;
      if (!fields || Object.keys(fields).length === 0) throw new Error("لم تُحدَّد حقول للتعديل");
      const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(docName)}`;
      // منع تعديل مستند معتمد (docstatus=1) للمستندات المحاسبية
      const transactional = ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"];
      if (transactional.includes(doctype)) {
        const cur = await erpGET(path) as { data?: { docstatus?: number } };
        if (cur?.data?.docstatus === 1) {
          throw new Error(`المستند ${docName} معتمد ولا يمكن تعديله مباشرة — يجب إلغاؤه أولاً (cancel_document) ثم إنشاء مستند بديل بالبيانات الصحيحة`);
        }
        if (cur?.data?.docstatus === 2) {
          throw new Error(`المستند ${docName} ملغى ولا يمكن تعديله`);
        }
      }
      const data = await erpPUT(path, fields) as { data: { name: string } };
      return {
        result: data?.data,
        display: `__DOC_UPDATED__${JSON.stringify({ doctype, name: data?.data?.name ?? docName, fields: Object.keys(fields) })}`,
      };
    }
    case "cancel_document": {
      const doctype = args.doctype as string;
      const docName = args.document_name as string;
      const result = await cancelDoc(doctype, docName);
      return {
        result,
        display: `__DOC_CANCELLED__${JSON.stringify({ doctype, name: result?.name ?? docName })}`,
      };
    }
    case "delete_document": {
      const doctype = args.doctype as string;
      const docName = args.document_name as string;
      const path = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(docName)}`;
      // إن كان المستند معتمداً — ألغِه أولاً (شرط ERPNext للحذف)
      const transactional = ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"];
      let wasCancelled = false;
      if (transactional.includes(doctype)) {
        try {
          const cur = await erpGET(path) as { data?: { docstatus?: number } };
          if (cur?.data?.docstatus === 1) {
            await cancelDoc(doctype, docName);
            wasCancelled = true;
          }
        } catch { /* المستند غير موجود — سيفشل الحذف برسالة واضحة */ }
      }
      await erpDELETE(path);
      return {
        result: { deleted: true, name: docName },
        display: `__DOC_DELETED__${JSON.stringify({ doctype, name: docName, cancelledFirst: wasCancelled })}`,
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
      conversationId: z.number().optional(),
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
    .mutation(async ({ input, ctx }) => {
      // ─── حفظ سجل المحادثة: إنشاء محادثة جديدة إن لم تُمرَّر، وحفظ رسالة المستخدم ───
      const dbHelpers = await import("../db");
      const lastUserMsg = [...input.messages].reverse().find(m => m.role === "user");
      let conversationId = input.conversationId;
      try {
        if (conversationId) {
          const conv = await dbHelpers.getConversationById(conversationId, ctx.user.id);
          if (!conv) conversationId = undefined;
        }
        if (!conversationId && lastUserMsg) {
          const title = lastUserMsg.content.slice(0, 80) || "محادثة جديدة";
          conversationId = await dbHelpers.createConversation(ctx.user.id, title);
        }
        if (conversationId && lastUserMsg) {
          await dbHelpers.addMessage(conversationId, "user", lastUserMsg.content);
        }
      } catch (e) {
        console.warn("[agent.chat] failed to persist conversation:", e instanceof Error ? e.message : e);
      }

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
   - **اختلاف الهمزات لا يعني سجلاً مختلفاً**: "اسلام" و"إسلام" و"أسلام" هم نفس العميل، وكذلك التاء المربوطة/الهاء (ة/ه) والألف المقصورة/الياء (ى/ي) — عاملها كنفس الاسم دائماً واستخدم السجل الموجود مهما اختلف الرسم الإملائي
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
9. **الاعتماد**: بعد إنشاء أي مستند (فاتورة/دفعة/قيد) اعرض اعتماده — إن وافق المستخدم أو طلبه معتمداً → استدعِ submit_invoice للفواتير أو submit_document لأي مستند آخر. المستند لا يؤثر على الحسابات إلا بعد الاعتماد
10. **الأرقام العربية**: حوّل الأرقام العربية (٦٥٠٠٠) إلى إنجليزية (65000) عند تمريرها للأدوات
11. **المستندات المستخرجة من الصور**: إذا احتوت المحادثة على "بيانات مستخرجة" من صورة (فاتورة/سند) وأكّد المستخدم التسجيل (نعم/سجّل/أكّد) → نفّذ فوراً حسب النوع: فاتورة مبيعات → سير إنشاء الفاتورة المعتاد (بحث عميل/أصناف ثم create_invoice) | فاتورة مشتريات → بحث مورد ثم create_purchase_invoice | سند قبض → create_payment_entry بنوع Receive | سند صرف → create_payment_entry بنوع Pay. إن صحّح المستخدم بيانات، استخدم البيانات المصحّحة
12. **التعديل**: لتعديل بيانات عميل/مورد/صنف → update_document مباشرة. لتعديل فاتورة/قيد/دفعة: إن كانت مسودة → update_document، وإن كانت معتمدة → أخبر المستخدم أنها تتطلب الإلغاء أولاً واعرض عليه: cancel_document ثم إنشاء مستند بديل بالبيانات الصحيحة
13. **الحذف والإلغاء**: delete_document حذف نهائي (يلغي المستند المعتمد تلقائياً قبل حذفه). **اطلب تأكيداً صريحاً من المستخدم قبل أي حذف أو إلغاء** واذكر رقم المستند وأثره (مثال: "إلغاء الفاتورة سيعكس أثرها من الحسابات — هل تؤكد؟"). لا تحذف أبداً دون تأكيد
## صلاحياتك الكاملة في النظام
أنت تملك صلاحيات كاملة للإدخال والتسجيل والاعتماد والتعديل والإلغاء والحذف في كل وحدات النظام (ضمن صلاحيات مستخدم ERPNext المتصل):
- **المبيعات**: فواتير مبيعات (إنشاء/عرض/اعتماد/تعديل/إلغاء/حذف)، عملاء (بحث/إنشاء/تعديل/حذف)
- **المشتريات**: فواتير مشتريات (create_purchase_invoice/get_purchase_invoices)، موردين (get_suppliers/create_supplier) — نفس قاعدة منع التكرار تنطبق على الموردين
- **التعديل والحذف الشامل**: update_document (تعديل أي حقل في فاتورة مسودة/عميل/مورد/صنف/قيد/دفعة)، cancel_document (إلغاء مستند معتمد)، delete_document (حذف نهائي مع إلغاء تلقائي للمعتمد) — أمثلة: "عدّل رقم جوال العميل محمود" → find_customer ثم update_document | "غيّر سعر صنف الاستشارة إلى 500" → find_item ثم update_document | "احذف الفاتورة SINV-0042" → تأكيد ثم delete_document | "ألغِ القيد JV-0010" → تأكيد ثم cancel_document
- **الدفعات**: create_payment_entry — تسجيل قبض من عميل (Receive) أو صرف لمورد (Pay)، مع إمكانية ربط الدفعة بفاتورة محددة لسدادها (reference_invoice). عند قول المستخدم "سجّل دفعة/سداد/قبض/تحصيل من عميل" → Receive، "دفعنا/سددنا لمورد" → Pay
- **قيود اليومية**: create_journal_entry — قيد مزدوج (مدين/دائن متساويان). قبل إنشاء القيد ابحث عن أسماء الحسابات الفعلية بـ get_accounts (الأسماء تتضمن اختصار الشركة مثل "Cash - X"). مثال: "سجل قيد: مدين الصندوق 3000 دائن المبيعات 3000" → get_accounts للصندوق والمبيعات ثم create_journal_entry
- **سير سداد فاتورة**: "سجل سداد فاتورة SINV-XXX" → get_invoice_detail لمعرفة العميل والمبلغ المتبقي → create_payment_entry مع reference_invoice → اعرض الاعتماد

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

      // تشغيل كامل حلقة الوكيل ضمن سياق اتصال ERPNext الخاص بالمستخدم الحالي
      return runWithErpConfig(ctx.user.id, async () => {
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
          if (conversationId && replyText) {
            try {
              await dbHelpers.addMessage(conversationId, "assistant", replyText,
                toolResults.length ? JSON.stringify(toolResults) : undefined);
            } catch { /* non-blocking */ }
          }
          return { reply: replyText, toolResults, conversationId };
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

      if (conversationId) {
        try {
          await dbHelpers.addMessage(conversationId, "assistant", "تم تنفيذ الطلب.",
            toolResults.length ? JSON.stringify(toolResults) : undefined);
        } catch { /* non-blocking */ }
      }
      return { reply: "تم تنفيذ الطلب.", toolResults, conversationId };
      });
    }),

  // ─── سجل المحادثات ────────────────────────────────────────────────────────
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    const dbHelpers = await import("../db");
    return dbHelpers.getConversationsByUserId(ctx.user.id);
  }),

  createConversation: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255).default("محادثة جديدة") }).optional())
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      const id = await dbHelpers.createConversation(ctx.user.id, input?.title ?? "محادثة جديدة");
      return { conversationId: id };
    }),

  getConversationMessages: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      const conv = await dbHelpers.getConversationById(input.conversationId, ctx.user.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "المحادثة غير موجودة" });
      const messages = await dbHelpers.getMessagesByConversationId(input.conversationId);
      return { conversation: conv, messages };
    }),

  renameConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), title: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      await dbHelpers.updateConversationTitle(input.conversationId, ctx.user.id, input.title);
      return { success: true };
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      await dbHelpers.deleteConversation(input.conversationId, ctx.user.id);
      return { success: true };
    }),

  getInvoicePdf: protectedProcedure
    .input(z.object({ invoiceName: z.string() }))
    .mutation(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      const erpUrl = erpBaseUrl();
      const sid = await getSession();
      const pdfUrl = `${erpUrl}/api/method/frappe.utils.print_format.download_pdf?doctype=Sales%20Invoice&name=${encodeURIComponent(input.invoiceName)}&format=Standard&no_letterhead=0`;
      const res = await fetch(pdfUrl, { headers: { Cookie: `sid=${sid}` } });
      if (!res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `PDF generation failed: ${res.status}` });
      }
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { pdfBase64: base64, filename: `${input.invoiceName}.pdf` };
    })),

  // ─── تحويل الصوت إلى نص (إدخال صوتي للوكيل) ─────────────────────────────
  transcribeVoice: protectedProcedure
    .input(z.object({
      audioBase64: z.string(),
      mimeType: z.string().default("audio/webm"),
    }))
    .mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.audioBase64, "base64");
      if (buffer.length > 15 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "التسجيل الصوتي كبير جداً — الحد الأقصى 15 ميجابايت" });
      }
      const ext = input.mimeType.includes("mp4") ? "m4a"
        : input.mimeType.includes("ogg") ? "ogg"
        : input.mimeType.includes("wav") ? "wav"
        : input.mimeType.includes("mpeg") ? "mp3"
        : "webm";
      const fileKey = `voice/${ctx.user.id}-${Date.now()}.${ext}`;
      // storagePut يعيد key نهائياً بلاحقة عشوائية — استخدمه هو لطلب الرابط الموقّع
      const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
      const signedUrl = await storageGetSignedUrl(key);
      try {
        const result = await transcribeAudio({
          audioUrl: signedUrl,
          prompt: "محادثة محاسبية بالعربية مع نظام ERP: فواتير، عملاء، أصناف، دفعات، قيود يومية، مبالغ بالريال",
        });
        if ("error" in result) {
          throw new Error(String(result.error));
        }
        const text = (result.text ?? "").trim();
        if (!text) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لم أتمكن من سماع كلام واضح في التسجيل — حاول مرة أخرى" });
        }
        return { text, audioUrl: url };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        console.error("[agent.transcribeVoice] failed:", e instanceof Error ? e.message : e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحويل التسجيل الصوتي إلى نص — حاول مرة أخرى" });
      }
    }),

  // ─── استخراج بيانات فاتورة/سند قبض من صورة (OCR بالذكاء الاصطناعي) ──────
  extractDocument: protectedProcedure
    .input(z.object({
      imageBase64: z.string(),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.imageBase64, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الصورة كبيرة جداً — الحد الأقصى 10 ميجابايت" });
      }
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const fileKey = `docs/${ctx.user.id}-${Date.now()}.${ext}`;
      const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
      const signedUrl = await storageGetSignedUrl(key);

      let response;
      try {
        response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "أنت خبير OCR محاسبي. استخرج بيانات المستند المالي من الصورة بدقة. حوّل الأرقام العربية (١٢٣) إلى إنجليزية (123). التواريخ بصيغة YYYY-MM-DD. إذا لم يكن المستند فاتورة أو سنداً مالياً، اجعل doc_type = unknown.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "استخرج بيانات هذا المستند المالي (فاتورة مبيعات، فاتورة مشتريات، أو سند قبض/صرف):" },
                { type: "image_url", image_url: { url: signedUrl, detail: "high" } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "financial_document",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  doc_type: { type: "string", enum: ["sales_invoice", "purchase_invoice", "receipt_voucher", "payment_voucher", "unknown"], description: "نوع المستند" },
                  party_name: { type: "string", description: "اسم العميل أو المورد أو الدافع" },
                  date: { type: "string", description: "تاريخ المستند YYYY-MM-DD أو فارغ" },
                  invoice_number: { type: "string", description: "رقم الفاتورة/السند في الصورة إن وجد" },
                  items: {
                    type: "array",
                    description: "الأصناف/البنود",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        qty: { type: "number" },
                        rate: { type: "number" },
                        amount: { type: "number" },
                      },
                      required: ["description", "qty", "rate", "amount"],
                      additionalProperties: false,
                    },
                  },
                  total_amount: { type: "number", description: "الإجمالي النهائي" },
                  vat_amount: { type: "number", description: "قيمة الضريبة إن وجدت وإلا 0" },
                  currency: { type: "string", description: "العملة إن ظهرت وإلا فارغ" },
                  notes: { type: "string", description: "أي ملاحظات مهمة أخرى في المستند" },
                },
                required: ["doc_type", "party_name", "date", "invoice_number", "items", "total_amount", "vat_amount", "currency", "notes"],
                additionalProperties: false,
              },
            },
          },
        });
      } catch (e) {
        console.error("[agent.extractDocument] LLM failed:", e instanceof Error ? e.message : e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر قراءة الصورة — تأكد من وضوحها وحاول مرة أخرى" });
      }

      const raw = response?.choices?.[0]?.message?.content;
      const jsonText = typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("")
          : "";
      let extracted: {
        doc_type: string; party_name: string; date: string; invoice_number: string;
        items: Array<{ description: string; qty: number; rate: number; amount: number }>;
        total_amount: number; vat_amount: number; currency: string; notes: string;
      };
      try {
        extracted = JSON.parse(jsonText);
      } catch {
        console.error("[agent.extractDocument] JSON parse failed:", jsonText?.slice(0, 300));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحليل بيانات المستند — حاول بصورة أوضح" });
      }

      if (extracted.doc_type === "unknown") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لم أتعرف على مستند مالي في هذه الصورة — تأكد أنها صورة فاتورة أو سند قبض/صرف واضحة" });
      }

      return { extracted, imageUrl: url };
    }),
});
