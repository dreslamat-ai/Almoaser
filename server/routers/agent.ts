/**
 * ERPNext AI Agent — Function Calling Router
 * الوكيل يقرر أي أداة يستدعي، ينفذها مباشرة على ERPNext، ويعيد النتائج الفعلية.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { invokeAgentLLM } from "../llmProvider";
import { logLlmUsage } from "../llmUsage";
import { storagePut, storageGetSignedUrl } from "../storage";
import { transcribeAudio } from "../_core/voiceTranscription";
import { getErpConfigForUser, getErpSession, invalidateErpSession, type ErpConfig } from "../erpConnection";
import { executeOdooTool } from "../odooTools";
import { notifyUser, notifyAdmins } from "../notifications";
import { buildExpertSkillsSection } from "./agentPersona";
import { parsePermissions } from "../organizations";
import type { MemberPermissions, User } from "../../drizzle/schema";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { trimHistory, messageCreditCost, MAX_MESSAGE_CHARS, MAX_MESSAGES } from "../../shared/chatLimits";
import { inspectCustomerCompleteness, describeMissing, type CustomerDoc, type AddressDoc } from "../customerCompleteness";
import { identityLineFor, modeRulesFor, toolsForMode, type AgentMode } from "../agentModes";

// ─── صلاحيات المستخدمين الفرعيين على أدوات الوكيل ─────────────────────────────
// null = القراءة/الاستخدام العام متاحة لكل المستخدمين (مالك أو فرعي) بلا قيد
const TOOL_PERMISSIONS: Record<string, keyof MemberPermissions | null> = {
  get_invoices: "viewInvoices", get_invoice_detail: "viewInvoices",
  get_customers: null, get_items: null, get_suppliers: null,
  create_invoice: "createInvoices", submit_invoice: "createInvoices",
  create_customer: "createInvoices", create_item: "createInvoices", create_supplier: "createInvoices",
  update_customer: "createInvoices",
  get_sales_report: "viewInvoices",
  get_purchase_invoices: "viewInvoices", create_purchase_invoice: "createInvoices",
  get_payments: "viewInvoices", create_payment_entry: "managePayments",
  get_accounts: null, get_journal_entries: "viewInvoices", create_journal_entry: "manageJournalEntries",
  submit_document: "createInvoices",
  print_document: "viewInvoices",
  update_document: "createInvoices",
  cancel_document: "manageJournalEntries",
  delete_document: "manageErpSettings",
  get_settings: "viewInvoices",
  update_settings: "manageErpSettings",
  check_tax_setup: "viewInvoices",
  setup_tax_settings: "manageErpSettings",
  // دورات العمل: قراءتها كقراءة، وإنشاؤها تغييرُ إعداداتٍ لا حركة محاسبية.
  // بلا تسجيلها هنا تصبح متاحة للجميع افتراضياً — وهو ما لا يصح لإنشائها.
  get_workflow_options: "viewInvoices",
  get_workflows: "viewInvoices",
  create_workflow: "manageErpSettings",
};

function requireToolPermission(user: User, toolName: string): void {
  if (user.orgRole === "owner") return;
  const required = TOOL_PERMISSIONS[toolName];
  if (!required) return;
  const perms = parsePermissions(user.permissions);
  if (!perms[required]) {
    throw new Error("ليس لديك صلاحية لتنفيذ هذا الإجراء — تواصل مع مدير الحساب لمنحك الصلاحية المطلوبة");
  }
}

/** هل يملك المستخدم صلاحية استخدام هذه الأداة؟ نفس قاعدة requireToolPermission بلا رمي. */
export function canUseTool(user: Pick<User, "orgRole" | "permissions">, toolName: string): boolean {
  if (user.orgRole === "owner") return true;
  const required = TOOL_PERMISSIONS[toolName];
  if (!required) return true;
  return Boolean(parsePermissions(user.permissions)[required]);
}

/**
 * الأدوات التي تُرسل تعريفاتها للنموذج.
 *
 * كانت الـ27 تعريفاً تُرسل كاملة لكل مستخدم ثم تُرفض عند التنفيذ إن لم يكن
 * مخوَّلاً. لذلك ضرران: تعريفات لا يمكن استعمالها تُدفع تكلفتها في كل استدعاء
 * (‏~21,400 حرف)، والأسوأ أن الوكيل كان يَعِد المستخدم بإجراء ثم يصطدم بالرفض
 * في منتصف المحادثة. الحجب هنا يجعله يقول "لا أستطيع" من البداية.
 *
 * هذا تضييق لا توسيع: requireToolPermission يظل هو الحارس عند التنفيذ، وما
 * يُحجب هنا كان سيُرفض هناك على أي حال.
 */
/**
 * يضيّق الأدوات بصلاحيات المستخدم في نظامه هو (ERPNext فقط).
 *
 * Odoo نموذج صلاحياته مختلف تماماً (ir.model.access) فيُترك على السلوك السابق
 * بدل تخمين ترجمة غير مختبَرة. وأي تعثّر — شبكة، مهلة، رد غير متوقع — يعيد
 * القائمة كما هي: هذه طبقة إرشادية، وERPNext يفرض صلاحياته عند التنفيذ سواء
 * نجحت القراءة أم لا، فمنعُ عميل من أدواته بسبب تعثّر شبكة خسارة بلا مقابل.
 */
async function narrowToolsByErpPermissions<T extends { function: { name: string } }>(
  tools: T[],
): Promise<T[]> {
  // النسخة الأولى كانت تُسجّل الدخول وتستدعي نظام العميل مرتين **داخل** مسار
  // الرسالة، فأضافت زمناً قبل أن يبدأ النموذج أصلاً. الآن: نقرأ المخزَّن فقط
  // (بلا شبكة)، ونحدّثه في الخلفية بلا انتظار. أول رسالة تمرّ بلا تضييق — وهذا
  // مقبول لأن الطبقة إرشادية وERPNext هو الحاجز الحقيقي عند التنفيذ.
  try {
    const cfg = currentErpConfig();
    if (cfg.provider !== "erpnext" || !cfg.url || !cfg.username) return tools;
    const { cachedErpCapabilities, fetchErpCapabilities, erpAllowsTool } = await import("../erpPermissions");
    const caps = cachedErpCapabilities(cfg.url, cfg.username);
    if (!caps) {
      // تحديث غير محجوب: لا ينتظره هذا الطلب، وتستفيد منه الرسائل التالية
      void (async () => {
        try {
          const sid = await getErpSession(cfg);
          await fetchErpCapabilities({ url: cfg.url, username: cfg.username, cookie: `sid=${sid}` });
        } catch { /* الطبقة إرشادية — الفشل هنا لا يعني شيئاً للمستخدم */ }
      })();
      return tools;
    }
    if (caps.unrestricted) return tools;
    return tools.filter(t => erpAllowsTool(caps, t.function.name));
  } catch (e) {
    console.warn("[agent] تعذّر تضييق الأدوات بصلاحيات ERP:", e instanceof Error ? e.message : e);
    return tools;
  }
}

export function toolsForUser<T extends { function: { name: string } }>(
  tools: T[],
  user: Pick<User, "orgRole" | "permissions">,
): T[] {
  if (user.orgRole === "owner") return tools;
  return tools.filter(t => canUseTool(user, t.function.name));
}

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
    provider: "erpnext",
  };
}

// ─── Quick Replies: استخراج أزرار الإجابات السريعة من رد الوكيل ─────────────
// الوكيل يُنهي أسئلته بسطر: [QUICK_REPLIES: خيار 1 | خيار 2 | ...]
// نستخرج الخيارات ونحذف السطر من النص المعروض للمستخدم
export function extractQuickReplies(raw: string): { text: string; quickReplies: string[] } {
  if (!raw) return { text: raw, quickReplies: [] };
  const regex = /\[QUICK_REPLIES:\s*([^\]]+)\]/gi;
  let quickReplies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    quickReplies = match[1]
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 6);
  }
  const text = raw.replace(/\s*\[QUICK_REPLIES:[^\]]*\]\s*/gi, "\n").trim();
  return { text, quickReplies };
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
      description: "إنشاء فاتورة مبيعات جديدة في ERPNext كمسودة. تُحتسب ضريبة القيمة المضافة 15% تلقائياً وفق النظام السعودي ما لم يحدد المستخدم خلاف ذلك",
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
                rate: { type: "number", description: "السعر (قبل الضريبة)" },
              },
              required: ["item_code", "qty", "rate"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "تاريخ الاستحقاق بصيغة YYYY-MM-DD (اختياري)" },
          apply_vat: { type: "boolean", description: "احتساب ضريبة القيمة المضافة 15% (الافتراضي true). اجعلها false فقط إذا طلب المستخدم صراحةً فاتورة بدون ضريبة أو معفاة" },
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
          tax_id: { type: "string", description: "الرقم الضريبي للعميل (15 رقماً يبدأ وينتهي بـ 3 وفق نظام ضريبة القيمة المضافة السعودي) — مطلوب للعملاء من نوع شركة/منشأة، اسأل المستخدم عنه عند إنشاء عميل شركة" },
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
      name: "update_customer",
      description: "تحديث بيانات عميل قائم: الرقم الضريبي، نوعه (شركة/فرد)، وعنوانه. استخدمها عند رفض إنشاء فاتورة بسبب customer_data_incomplete — اطلب الناقص من المستخدم أولاً ثم سجّله هنا. الرقم الضريبي يُفحص شكلياً ويُرفض إن كانت صيغته خاطئة",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string", description: "اسم العميل كما هو في النظام" },
          tax_id: { type: "string", description: "الرقم الضريبي — اتركه فارغاً لعدم تغييره" },
          customer_type: { type: "string", enum: ["Company", "Individual"], description: "نوع العميل" },
          address_line1: { type: "string", description: "الشارع/المبنى" },
          city: { type: "string", description: "المدينة" },
          country: { type: "string", description: "الدولة" },
          pincode: { type: "string", description: "الرمز البريدي" },
        },
        required: ["customer"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_report",
      description: "حفظ تقرير رسمي في حساب العميل (تقييم نظام، بنود استلام، مراجعة عقد، سياسات، تصميم دورة عمل). استدعها بعد أن تكتب التقرير كاملاً في المحادثة — الحفظ يجعله مستنداً يُفتح لاحقاً ويُراجع، ويُشعر إدارة المنصة. التقرير يُحفظ بانتظار مراجعة العميل",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["system_assessment", "handover_terms", "contract_review", "policies", "workflow_design", "other"], description: "نوع التقرير" },
          title: { type: "string", description: "عنوان واضح يميّزه لاحقاً" },
          content: { type: "string", description: "نص التقرير كاملاً بصيغة Markdown، بأقسامه الثلاثة: فُحص / لم يُفحص / يحتاج قراراً بشرياً" },
        },
        required: ["kind", "title", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_workflow_options",
      description: "قراءة الحالات والإجراءات والأدوار المتاحة في نظام العميل لبناء دورة عمل. **استدعها دائماً قبل create_workflow** — أسماء الحالات والإجراءات روابط لسجلات قائمة، واختراع اسم غير موجود يُفشل الإنشاء",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_workflows",
      description: "عرض دورات العمل (Workflows) المعرّفة في نظام العميل، اختيارياً لنوع مستند بعينه. استخدمها عند تقييم النظام أو قبل اقتراح دورة جديدة",
      parameters: {
        type: "object",
        properties: { document_type: { type: "string", description: "نوع المستند مثل Sales Invoice — اتركه فارغاً لعرض الكل" } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_workflow",
      description: "إنشاء دورة عمل (Workflow) لنوع مستند: حالات وانتقالات وأدوار الموافقة. إعداد نظام لا حركة محاسبية. **لا تستدعِها قبل عرض التصميم على العميل والحصول على موافقته الصريحة** — ترفض التنفيذ إن لم تُمرّر confirmed: true",
      parameters: {
        type: "object",
        properties: {
          workflow_name: { type: "string", description: "اسم دورة العمل" },
          document_type: { type: "string", description: "نوع المستند مثل Sales Invoice" },
          states: {
            type: "array",
            description: "الحالات بالترتيب",
            items: {
              type: "object",
              properties: {
                state: { type: "string", description: "اسم الحالة" },
                allow_edit: { type: "string", description: "الدور الذي يملك التعديل في هذه الحالة" },
                doc_status: { type: "string", enum: ["0", "1", "2"], description: "0 مسودة، 1 مُرحّل، 2 ملغى" },
              },
              required: ["state", "allow_edit", "doc_status"],
              additionalProperties: false,
            },
          },
          transitions: {
            type: "array",
            description: "الانتقالات بين الحالات",
            items: {
              type: "object",
              properties: {
                state: { type: "string", description: "الحالة الحالية" },
                action: { type: "string", description: "اسم الإجراء" },
                next_state: { type: "string", description: "الحالة التالية" },
                allowed: { type: "string", description: "الدور المسموح له بالإجراء" },
              },
              required: ["state", "action", "next_state", "allowed"],
              additionalProperties: false,
            },
          },
          confirmed: { type: "boolean", description: "true فقط بعد موافقة العميل الصريحة على التصميم" },
        },
        required: ["workflow_name", "document_type", "states", "transitions", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_tax_setup",
      description: "فحص إعدادات الضريبة في نظام العميل (قالب ضريبة المبيعات + الرقم الضريبي للشركة). استخدمها في بداية التعامل مع عميل جديد أو عند أي شك، وأبلغ العميل بنتيجتها إن كان هناك نقص",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "setup_tax_settings",
      description: "ضبط إعدادات الضريبة للعميل: إنشاء قالب ضريبة مبيعات افتراضي بالنسبة المطلوبة و/أو تسجيل الرقم الضريبي للشركة. **لا تستدعِها أبداً قبل أن تُبلغ العميل بما هو ناقص وتحصل على موافقته الصريحة** — الأداة ترفض التنفيذ إن لم تُمرّر confirmed: true",
      parameters: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "اجعلها true فقط بعد أن يوافق العميل صراحةً على أن تضبط له إعدادات الضريبة" },
          rate: { type: "number", description: "نسبة الضريبة المئوية (15 للسعودية، 14 لمصر، 5 للإمارات... اسأل العميل إن لم تكن متأكداً)" },
          company_tax_id: { type: "string", description: "الرقم الضريبي للشركة (البائع) إن كان ناقصاً وأعطاه العميل" },
          account_head: { type: "string", description: "اسم الحساب الضريبي في شجرة الحسابات (اختياري — يُحل تلقائياً إن تُرك فارغاً)" },
        },
        required: ["confirmed", "rate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "print_document",
      description: "استخدمها دائماً عندما يطلب العميل طباعة أو تنزيل PDF أو إرسال نسخة من أي مستند موجود بالفعل (فاتورة مبيعات، فاتورة مشتريات، دفعة، أو قيد يومية). تعرض للعميل زر تحميل PDF فوري بنموذج الطباعة الفعلي المُعدّ في نظامه. لا ترفض طلب الطباعة أبداً — استخدم هذه الأداة دوماً بدل الاعتذار",
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
  {
    type: "function" as const,
    function: {
      name: "get_settings",
      description: "قراءة إعدادات النظام لأي DocType إعدادات في ERPNext: بيانات الشركة، إعدادات البيع/الشراء/المخزون/الحسابات/النظام، قوالب الضرائب، طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق، POS Profile، شروط الدفع، السنة المالية، مراكز التكلفة، المستودعات، وغيرها. استخدمها لفهم الإعدادات الحالية قبل أي تعديل",
      parameters: {
        type: "object",
        properties: {
          settings_type: {
            type: "string",
            description: "اسم DocType الإعدادات بالإنجليزية كما في ERPNext. أمثلة: Company, Selling Settings, Buying Settings, Stock Settings, Accounts Settings, System Settings, Global Defaults, Sales Taxes and Charges Template, Purchase Taxes and Charges Template, Mode of Payment, POS Profile, Payment Terms Template, Fiscal Year, Cost Center, Warehouse, Currency Exchange, Print Settings — أو أي DocType آخر",
          },
          name: { type: "string", description: "اسم السجل المحدد (مطلوب للشركة أو قالب ضريبة محدد — اتركه فارغاً لجلب القائمة أو الإعدادات العامة)" },
        },
        required: ["settings_type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_settings",
      description: "تعديل إعدادات النظام لأي DocType إعدادات في ERPNext ضمن صلاحيات المستخدم المتصل: بيانات الشركة، إعدادات الموديولات، قوالب الضرائب، طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق عبر الحقل accounts (جدول فرعي: [{company, default_account}])، POS Profile، شروط الدفع، وغيرها. اقرأ الإعدادات بـ get_settings أولاً، ولخّص للمستخدم ما ستغيّره قبل التنفيذ. لا ترفض أي طلب إعدادات استباقياً — نفّذه وإن رفضه ERPNext انقل رسالة الخطأ",
      parameters: {
        type: "object",
        properties: {
          settings_type: {
            type: "string",
            description: "اسم DocType الإعدادات بالإنجليزية كما في ERPNext. أمثلة: Company, Selling Settings, Accounts Settings, Mode of Payment, POS Profile, Payment Terms Template, Sales Taxes and Charges Template — أو أي DocType آخر",
          },
          name: { type: "string", description: "اسم السجل المحدد (مطلوب للشركة أو قالب ضريبة — اتركه فارغاً لمستندات الإعدادات الفردية مثل Selling Settings)" },
          fields: {
            type: "object",
            description: "الحقول المراد تعديلها وقيمها الجديدة، مثل {\"tax_id\": \"310000000000003\"} أو للجداول الفرعية مثل ربط طريقة دفع بحساب: {\"accounts\": [{\"company\": \"اسم الشركة\", \"default_account\": \"اسم الحساب\"}]}",
            additionalProperties: true,
          },
        },
        required: ["settings_type", "fields"],
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
    // رسائل ERPNext المعرّبة: "لا يمكن أن تجد طريقة الدفع: Cash" أو نص unicode-escaped في exception
    const mAr = raw.match(/لا يمكن أن تجد ([^:]+): ([^"\\,}]+)/);
    if (mAr) return `السجل المرتبط غير موجود: ${mAr[1].trim()} "${mAr[2].trim()}" — استخدم الاسم الفعلي كما هو مسجل في النظام (ابحث عنه أولاً)`;
    try {
      const unescaped = JSON.parse(`"${raw.match(/"exception":"([^"]+)"/)?.[1] ?? ""}"`);
      const mU = unescaped.match(/لا يمكن أن تجد ([^:]+): (.+)$/) ?? unescaped.match(/Could not find ([^:]+): (.+)$/i);
      if (mU) return `السجل المرتبط غير موجود: ${mU[1].trim()} "${mU[2].trim()}" — استخدم الاسم الفعلي كما هو مسجل في النظام (ابحث عنه أولاً)`;
    } catch { /* تجاهل */ }
    return "أحد السجلات المرتبطة (عميل/صنف/حساب) غير موجود في النظام";
  }
  if (/DuplicateEntryError|already exists/i.test(raw)) return "السجل موجود مسبقاً — استخدم الموجود بدلاً من إنشاء نسخة مكررة";
  if (/MandatoryError|is mandatory/i.test(raw)) return "حقل إلزامي ناقص: " + raw.slice(0, 200);
  if (/PermissionError|not permitted/i.test(raw)) return "صلاحيات غير كافية لتنفيذ هذه العملية في ERPNext";
  if (/ValidationError/i.test(raw)) return "خطأ تحقق من ERPNext: " + raw.slice(0, 200);
  return raw.slice(0, 300);
}

// مستندات الإعدادات الفردية (Single DocTypes) في Frappe/ERPNext: ليس لها جدول سجلات،
// وتُقرأ وتُعدَّل باسم النوع نفسه. استعلامها كقائمة يفشل بـ ProgrammingError،
// لذا أي Single DocType جديد يستخدمه الوكيل يجب إضافته هنا.
const SINGLE_DOCTYPES = new Set([
  "Selling Settings", "Buying Settings", "Stock Settings", "Accounts Settings",
  "System Settings", "Global Defaults", "Print Settings", "Naming Series",
  "HR Settings", "Payroll Settings", "Manufacturing Settings", "Support Settings",
  "Website Settings", "Portal Settings", "E Commerce Settings", "CRM Settings",
  "Projects Settings", "Domain Settings",
]);

// ─── الشركة ومركز التكلفة ─────────────────────────────────────────────────────
// نمرّر company صراحةً في المستندات بدل الاعتماد على Global Defaults، لأن كثيراً
// من تنصيبات ERPNext تحتوي default_company يشير إلى شركة محذوفة/معاد تسميتها،
// فتفشل المستندات بأخطاء "مركز التكلفة لا ينتمي للشركة".
type CompanyInfo = { name: string; costCenter: string | null };
const companyCache = new Map<string, { info: CompanyInfo | null; expiry: number }>();
const COMPANY_CACHE_TTL = 10 * 60 * 1000;

async function resolveCompanyInfo(): Promise<CompanyInfo | null> {
  const key = erpBaseUrl();
  const cached = companyCache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.info;

  let info: CompanyInfo | null = null;
  try {
    const fields = encodeURIComponent(JSON.stringify(["name", "cost_center"]));
    const list = await erpGET(`/api/resource/Company?limit=20&fields=${fields}`) as { data?: Array<{ name: string; cost_center?: string }> };
    const companies = list?.data ?? [];
    if (companies.length === 1) {
      info = { name: companies[0].name, costCenter: companies[0].cost_center ?? null };
    } else if (companies.length > 1) {
      // شركات متعددة: نستخدم الافتراضية إن كانت موجودة فعلاً، وإلا أول شركة
      let preferred: string | null = null;
      try {
        const gd = await erpGET(`/api/resource/Global%20Defaults/Global%20Defaults`) as { data?: { default_company?: string } };
        preferred = gd?.data?.default_company ?? null;
      } catch { /* غير حرج */ }
      const match = companies.find(c => c.name === preferred) ?? companies[0];
      if (preferred && !companies.some(c => c.name === preferred)) {
        console.warn(`[company] Global Defaults.default_company="${preferred}" لا يوجد ضمن الشركات الفعلية — استُخدمت "${match.name}" بدلاً منه`);
      }
      info = { name: match.name, costCenter: match.cost_center ?? null };
    }
  } catch (e) {
    console.warn("[company] resolve failed:", e instanceof Error ? e.message : e);
  }

  companyCache.set(key, { info, expiry: Date.now() + COMPANY_CACHE_TTL });
  return info;
}

/** هل الخطأ سببه مركز تكلفة لا ينتمي للشركة؟ (ERPNext يعرّبها) */
function isCostCenterMismatch(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /cost center|مركز التكلفة/i.test(raw) && /belong|ينتمي/i.test(raw);
}

/**
 * ينشئ مستند بيع/شراء، وإن رفض ERPNext مركز التكلفة (لأن الأصناف تحمل
 * item_defaults قديمة لشركة محذوفة) يعيد المحاولة مرة واحدة بمركز تكلفة الشركة
 * الصحيح بدل أن يفشل الطلب على العميل.
 */
async function postDocWithCostCenterRetry(
  path: string,
  doc: Record<string, unknown>,
  company: CompanyInfo | null,
): Promise<unknown> {
  try {
    return await erpPOST(path, doc);
  } catch (e) {
    if (!isCostCenterMismatch(e) || !company?.costCenter) throw e;
    console.warn(`[createDoc] cost center rejected — retrying with "${company.costCenter}"`);
    const items = (doc.items as Array<Record<string, unknown>> | undefined) ?? [];
    return erpPOST(path, {
      ...doc,
      cost_center: company.costCenter,
      items: items.map(it => ({ ...it, cost_center: company.costCenter })),
    });
  }
}

/** يتحقق من صيغة الرقم الضريبي وفق بلد الشركة المسجّل في ERP */
async function checkTaxIdForCompanyCountry(taxId: string): Promise<{ valid: true; normalized: string } | { valid: false; reason: string }> {
  const { validateTaxId, countryToTaxIdCountry } = await import("../taxId");
  let country: string | null = null;
  try {
    const comp = await erpGET(`/api/resource/Company?limit=1&fields=${encodeURIComponent(JSON.stringify(["name", "country"]))}`) as { data?: Array<{ country?: string }> };
    country = comp?.data?.[0]?.country ?? null;
  } catch { /* نكمل بالافتراضي */ }
  const res = validateTaxId(taxId, countryToTaxIdCountry(country));
  return res.valid ? { valid: true, normalized: res.normalized } : { valid: false, reason: res.reason };
}

// ─── فحص إعدادات الضريبة في نظام العميل ───────────────────────────────────────
// يرجع القالب الافتراضي وصفوفه إن كانت الإعدادات سليمة، أو تفصيل ما هو ناقص
// حتى يبلّغ الوكيل العميل ويأخذ موافقته على ضبطها (setup_tax_settings)
type TaxSetupOk = { ok: true; template: string; taxRows: Array<Record<string, unknown>>; companyTaxId?: string | null };
type TaxSetupGap = { ok: false; missing: string[]; message: string; company?: string; companyTaxId?: string | null; availableTaxAccounts?: string[] };

async function inspectTaxSetup(): Promise<TaxSetupOk | TaxSetupGap> {
  const missing: string[] = [];
  let company: string | undefined;
  let companyTaxId: string | null = null;

  // الرقم الضريبي للشركة (البائع) — بدونه الفاتورة الضريبية غير مكتملة
  try {
    const compList = await erpGET(`/api/resource/Company?limit=1&fields=${encodeURIComponent(JSON.stringify(["name", "tax_id"]))}`) as { data?: Array<{ name: string; tax_id?: string }> };
    company = compList?.data?.[0]?.name;
    companyTaxId = compList?.data?.[0]?.tax_id ?? null;
    if (!companyTaxId) missing.push("الرقم الضريبي للشركة (البائع) غير مسجّل في بيانات الشركة");
  } catch { /* غير حرج للفحص */ }

  // قالب ضريبة المبيعات الافتراضي + صفوفه
  let template: string | null = null;
  let taxRows: Array<Record<string, unknown>> = [];
  try {
    const tplFields = encodeURIComponent(JSON.stringify(["name", "is_default"]));
    const tplData = await erpGET(`/api/resource/Sales%20Taxes%20and%20Charges%20Template?limit=10&fields=${tplFields}&filters=${encodeURIComponent(JSON.stringify([["disabled", "=", 0]]))}`) as { data?: Array<{ name: string; is_default: number }> };
    const templates = tplData?.data ?? [];
    template = templates.find(t => t.is_default === 1)?.name ?? templates[0]?.name ?? null;
    if (!template) {
      missing.push("لا يوجد قالب ضريبة مبيعات (Sales Taxes and Charges Template) في النظام");
    } else {
      const tplDoc = await erpGET(`/api/resource/Sales%20Taxes%20and%20Charges%20Template/${encodeURIComponent(template)}`) as { data?: { taxes?: Array<{ charge_type: string; account_head: string; rate: number; description: string }> } };
      taxRows = (tplDoc?.data?.taxes ?? []).map(t => ({
        charge_type: t.charge_type, account_head: t.account_head, rate: t.rate, description: t.description,
      }));
      if (taxRows.length === 0) {
        missing.push(`قالب الضريبة "${template}" موجود لكنه فارغ (لا يحتوي أي نسبة ضريبة)`);
      }
    }
  } catch (e) {
    missing.push(`تعذّر قراءة قوالب الضريبة من النظام: ${e instanceof Error ? e.message : "خطأ غير معروف"}`);
  }

  // كل الإعدادات سليمة: قالب فيه نسبة فعلية + رقم ضريبي للشركة (يظهر على كل فاتورة ضريبية)
  if (missing.length === 0 && template) {
    return { ok: true, template, taxRows, companyTaxId };
  }

  // حسابات ضريبية متاحة لبناء القالب
  let availableTaxAccounts: string[] | undefined;
  try {
    const accFilters = encodeURIComponent(JSON.stringify([["is_group", "=", 0], ["root_type", "=", "Liability"]]));
    const accData = await erpGET(`/api/resource/Account?limit=25&fields=${encodeURIComponent(JSON.stringify(["name", "account_type"]))}&filters=${accFilters}`) as { data?: Array<{ name: string; account_type?: string }> };
    availableTaxAccounts = (accData?.data ?? [])
      .filter(a => a.account_type === "Tax" || /vat|tax|ضريب/i.test(a.name))
      .map(a => a.name);
  } catch { /* غير حرج */ }

  return {
    ok: false,
    missing,
    message: "إعدادات الضريبة غير مضبوطة في نظام العميل — أبلغ العميل بما هو ناقص واطلب موافقته الصريحة قبل ضبطها بـ setup_tax_settings",
    company, companyTaxId, availableTaxAccounts,
  };
}


/**
 * عنوان العميل: من customer_primary_address إن وُجد، وإلا بحثاً في Address عبر
 * جدول الربط الديناميكي — العناوين في Frappe ليست حقلاً في العميل بل مستنداً
 * مرتبطاً، وكثير من الحسابات لا تملأ حقل العنوان الأساسي أصلاً.
 */
async function fetchCustomerAddress(customerName: string, primary: string | null): Promise<AddressDoc> {
  const fields = encodeURIComponent(JSON.stringify(["address_line1", "city", "country", "pincode"]));
  try {
    if (primary) {
      const doc = await erpGET(`/api/resource/Address/${encodeURIComponent(primary)}`) as { data?: AddressDoc };
      if (doc?.data) return doc.data;
    }
    const filters = encodeURIComponent(JSON.stringify([["Dynamic Link", "link_name", "=", customerName]]));
    const list = await erpGET(`/api/resource/Address?filters=${filters}&fields=${fields}&limit_page_length=1`) as { data?: AddressDoc[] };
    return list?.data?.[0] ?? null;
  } catch (e) {
    // تعذّر القراءة ≠ لا يوجد عنوان. نعيد null فيُطلب العنوان — الطلب مرة
    // زائدة أهون من إصدار فاتورة ضريبية ناقصة.
    console.warn("[fetchCustomerAddress] تعذّرت قراءة العنوان:", e instanceof Error ? e.message : e);
    return null;
  }
}


/** اسم مستند العنوان المرتبط بالعميل (لا محتواه) — للتحديث بدل إنشاء ثانٍ */
async function fetchCustomerAddressName(customerName: string, primary: string | null): Promise<string | null> {
  if (primary) return primary;
  try {
    const filters = encodeURIComponent(JSON.stringify([["Dynamic Link", "link_name", "=", customerName]]));
    const list = await erpGET(`/api/resource/Address?filters=${filters}&fields=${encodeURIComponent(JSON.stringify(["name"]))}&limit_page_length=1`) as { data?: { name: string }[] };
    return list?.data?.[0]?.name ?? null;
  } catch { return null; }
}

type ToolCtx = { userId: number; conversationId?: number };
async function executeTool(name: string, args: Record<string, unknown>, toolCtx?: ToolCtx): Promise<{ result: unknown; display: string }> {
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
      // حماية: الفاتورة الضريبية تتطلب رقماً ضريبياً مسجلاً للعميل من نوع شركة/مؤسسة —
      // امنع إنشاء الفاتورة وأعد needs_clarification بدل إنشائها ناقصة
      try {
        const custDoc = await erpGET(`/api/resource/Customer/${encodeURIComponent(resolvedCustomer)}`) as { data: CustomerDoc };
        const address = await fetchCustomerAddress(resolvedCustomer, custDoc?.data?.customer_primary_address ?? null);
        const completeness = inspectCustomerCompleteness(custDoc?.data ?? {}, address);
        if (!completeness.complete) {
          return {
            result: {
              needs_clarification: true,
              reason: "customer_data_incomplete",
              customer: resolvedCustomer,
              customer_name: custDoc?.data?.customer_name ?? resolvedCustomer,
              missing: completeness.missing,
              missing_ar: describeMissing(completeness.missing),
              message: `لا يمكن إصدار فاتورة ضريبية لهذا العميل قبل استكمال: ${describeMissing(completeness.missing)}. اطلب هذه البيانات من المستخدم ثم سجّلها بـ update_customer، ولا تُصدر الفاتورة قبل ذلك`,
            },
            display: "",
          };
        }
        if (completeness.warnings.length) {
          console.info("[create_invoice] بيانات ناقصة غير مانعة:", completeness.warnings.join(","));
        }
      } catch (e) {
        console.warn("[create_invoice] customer completeness check failed:", e instanceof Error ? e.message : e);
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
      // ─── ضريبة القيمة المضافة: تُطبَّق من قوالب الضرائب الجاهزة في نظام المعاصر ───
      // نجلب القالب الافتراضي (أو الأول المتاح) من Sales Taxes and Charges Template دون أي إعداد يدوي من الوكيل
      const applyVat = (args.apply_vat as boolean) ?? true;
      let taxTemplate: string | null = null;
      let taxRows: Array<Record<string, unknown>> = [];
      if (applyVat) {
        // لا نُصدر فاتورة ضريبية بصمت بدون ضريبة: إن لم تكن إعدادات الضريبة مضبوطة
        // نوقف الإنشاء ونطلب من الوكيل إبلاغ العميل وأخذ موافقته على ضبطها
        const taxSetup = await inspectTaxSetup();
        if (!taxSetup.ok) {
          return { result: { needs_clarification: true, reason: "tax_settings_not_configured", ...taxSetup }, display: "" };
        }
        taxTemplate = taxSetup.template;
        taxRows = taxSetup.taxRows;
      }
      const company = await resolveCompanyInfo();
      const invoiceDoc = {
        ...(company ? { company: company.name } : {}),
        customer: resolvedCustomer,
        posting_date: today,
        due_date: safeDueDate,
        items: resolvedItems.map(i => ({
          item_code: i.item_code,
          qty: i.qty,
          rate: i.rate,
          amount: i.qty * i.rate,
        })),
        ...(taxTemplate && taxRows.length > 0 ? { taxes_and_charges: taxTemplate, taxes: taxRows } : {}),
      };
      const data = await postDocWithCostCenterRetry("/api/resource/Sales%20Invoice", invoiceDoc, company) as { data: { name: string; grand_total: number; total_taxes_and_charges?: number; net_total?: number } };
      const invoiceName = data?.data?.name ?? "SINV-???";
      return {
        result: data?.data,
        display: `__INVOICE_CREATED__${JSON.stringify({ name: invoiceName, customer: resolvedCustomer, items: resolvedItems, grand_total: data?.data?.grand_total, net_total: data?.data?.net_total, total_taxes: data?.data?.total_taxes_and_charges, tax_template: taxTemplate })}`,
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
      // تحقق من صيغة الرقم الضريبي قبل تخزينه — لا نُخزّن رقماً مستحيلاً أو مفبركاً
      if (args.tax_id) {
        const check = await checkTaxIdForCompanyCountry(String(args.tax_id));
        if (!check.valid) {
          return { result: { needs_clarification: true, reason: "invalid_tax_id", provided: String(args.tax_id), problem: check.reason, message: "الرقم الضريبي الذي أعطاه العميل غير صحيح الصيغة — أبلغه بالمشكلة واطلب الرقم الصحيح" }, display: "" };
        }
        args.tax_id = check.normalized;
      }
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
        ...(args.tax_id ? { tax_id: args.tax_id } : {}),
      };
      const data = await erpPOST("/api/resource/Customer", customerDoc) as { data: { name: string; customer_name: string; customer_type: string; tax_id?: string } };
      return {
        result: data?.data,
        display: `__CUSTOMER_CREATED__${JSON.stringify({ name: data?.data?.name, customer_name: data?.data?.customer_name, customer_type: data?.data?.customer_type, tax_id: data?.data?.tax_id })}`,
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
      const piCompany = await resolveCompanyInfo();
      const piDoc = {
        ...(piCompany ? { company: piCompany.name } : {}),
        supplier: resolvedSupplier,
        posting_date: today,
        due_date: safePiDueDate,
        items: resolvedItems.map(i => ({ item_code: i.item_code, qty: i.qty, rate: i.rate, amount: i.qty * i.rate })),
      };
      const data = await postDocWithCostCenterRetry("/api/resource/Purchase%20Invoice", piDoc, piCompany) as { data: { name: string; grand_total: number } };
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
      };
      // حل طريقة الدفع بمطابقة ذكية مع طرق الدفع الفعلية في النظام
      if (args.mode_of_payment) {
        const requested = String(args.mode_of_payment);
        const mopData = await erpGET(`/api/resource/Mode%20of%20Payment?fields=${encodeURIComponent(JSON.stringify(["name"]))}&filters=${encodeURIComponent(JSON.stringify([["enabled", "=", 1]]))}`) as { data: Array<{ name: string }> };
        const mops = (mopData?.data ?? []).map(m => m.name);
        // مطابقة مباشرة أو تقريبية أو ترجمة إنجليزي→عربي شائعة
        const EN_AR: Record<string, string[]> = {
          cash: ["نقد", "نقدي", "كاش"],
          "bank transfer": ["حوالة مصرفية", "تحويل بنكي", "حوالة"],
          "wire transfer": ["حوالة مصرفية", "تحويل بنكي"],
          cheque: ["شيك"],
          check: ["شيك"],
          "credit card": ["بطاقة ائتمان", "بطاقة"],
          card: ["بطاقة ائتمان", "بطاقة"],
          "bank draft": ["مسودة بنكية"],
        };
        const norm = (s: string) => normalizeArabic(s.trim().toLowerCase());
        let resolvedMop = mops.find(m => norm(m) === norm(requested))
          ?? mops.find(m => norm(m).includes(norm(requested)) || norm(requested).includes(norm(m)));
        if (!resolvedMop) {
          const aliases = EN_AR[requested.trim().toLowerCase()] ?? [];
          resolvedMop = mops.find(m => aliases.some(a => norm(m) === norm(a) || norm(m).includes(norm(a))));
        }
        if (resolvedMop) {
          paymentDoc.mode_of_payment = resolvedMop;
        } else if (mops.length) {
          return { result: { needs_clarification: true, reason: "mode_of_payment_not_found", requested, available_modes: mops, hint: "اختر إحدى طرق الدفع المتاحة في النظام" }, display: "" };
        }
        // إن لم توجد أي طرق دفع معرفة، نتجاهل الحقل ونكمل بالحسابات الافتراضية
      }
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
    case "update_customer": {
      const customer = String(args.customer ?? "").trim();
      if (!customer) return { result: { ok: false, error: "اسم العميل مطلوب" }, display: "" };

      const custFields: Record<string, unknown> = {};
      if (args.customer_type) custFields.customer_type = args.customer_type;
      if (typeof args.tax_id === "string" && args.tax_id.trim()) {
        // نفس فحص create_customer: صيغة فقط، ولا يُقال للعميل إنه "تحقق لدى الهيئة"
        const { validateTaxId } = await import("../taxId");
        const check = validateTaxId(args.tax_id.trim());
        if (!check.valid) {
          return { result: { needs_clarification: true, reason: "invalid_tax_id", provided: String(args.tax_id),
            problem: check.reason, message: "الرقم الضريبي الذي أعطاه المستخدم غير صحيح الصيغة — أبلغه بالمشكلة واطلب الرقم الصحيح" }, display: "" };
        }
        custFields.tax_id = check.normalized;
      }
      if (Object.keys(custFields).length) {
        await erpPUT(`/api/resource/Customer/${encodeURIComponent(customer)}`, custFields);
      }

      // العنوان مستند مستقل مرتبط بالعميل، لا حقول داخله
      const addrInput = {
        address_line1: typeof args.address_line1 === "string" ? args.address_line1.trim() : "",
        city: typeof args.city === "string" ? args.city.trim() : "",
        country: typeof args.country === "string" ? args.country.trim() : "",
        pincode: typeof args.pincode === "string" ? args.pincode.trim() : "",
      };
      let addressAction: string | null = null;
      if (addrInput.address_line1 || addrInput.city || addrInput.country || addrInput.pincode) {
        const custDoc = await erpGET(`/api/resource/Customer/${encodeURIComponent(customer)}`) as { data?: CustomerDoc };
        const existingName = custDoc?.data?.customer_primary_address ?? null;
        const existing = await fetchCustomerAddressName(customer, existingName);
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(addrInput)) if (v) payload[k] = v;
        if (existing) {
          await erpPUT(`/api/resource/Address/${encodeURIComponent(existing)}`, payload);
          addressAction = "updated";
        } else {
          // العنوان الجديد يحتاج حقوله الإلزامية كاملة وربطاً بالعميل
          if (!addrInput.address_line1 || !addrInput.city || !addrInput.country) {
            return { result: { needs_clarification: true, reason: "address_incomplete",
              message: "لإنشاء عنوان جديد نحتاج الشارع/المبنى والمدينة والدولة معاً — اطلبها من المستخدم" }, display: "" };
          }
          await erpPOST("/api/resource/Address", {
            ...payload,
            address_title: customer,
            address_type: "Billing",
            links: [{ link_doctype: "Customer", link_name: customer }],
          });
          addressAction = "created";
        }
      }

      const after = await erpGET(`/api/resource/Customer/${encodeURIComponent(customer)}`) as { data?: CustomerDoc };
      const addrAfter = await fetchCustomerAddress(customer, after?.data?.customer_primary_address ?? null);
      const state = inspectCustomerCompleteness(after?.data ?? {}, addrAfter);
      return {
        result: {
          ok: true, customer, address: addressAction,
          complete: state.complete,
          still_missing: state.missing,
          still_missing_ar: describeMissing(state.missing),
          note: state.complete
            ? "بيانات العميل مكتملة — يمكن إصدار الفاتورة الآن"
            : `ما زال ناقصاً: ${describeMissing(state.missing)} — اطلبه من المستخدم قبل إصدار الفاتورة`,
        },
        display: `__CUSTOMER_UPDATED__${JSON.stringify({ customer, complete: state.complete, missing: state.missing })}`,
      };
    }

    case "save_report": {
      const kind = String(args.kind ?? "other");
      const title = String(args.title ?? "").trim();
      const content = String(args.content ?? "").trim();
      if (!title || content.length < 50) {
        return { result: { ok: false, error: "العنوان مطلوب، ونص التقرير يجب أن يكون مكتملاً لا سطراً واحداً" }, display: "" };
      }
      const { createReport, REPORT_KIND_LABELS } = await import("../reports");
      const ownerId = toolCtx?.userId;
      // بلا سياق مستخدم لا يُعرف صاحب التقرير — الحفظ في حساب خاطئ أسوأ من عدمه
      if (!ownerId) return { result: { ok: false, error: "تعذّر تحديد حساب العميل لحفظ التقرير" }, display: "" };
      const id = await createReport({
        userId: ownerId, conversationId: toolCtx?.conversationId ?? null,
        kind: kind as Parameters<typeof createReport>[0]["kind"], title, content,
      });
      if (!id) return { result: { ok: false, error: "تعذّر حفظ التقرير" }, display: "" };
      // إشعار إدارة المنصة — لا يُفشل الحفظ إن تعذّر
      try {
        const { notifyAdmins } = await import("../notifications");
        await notifyAdmins({
          type: "report_created",
          title: `تقرير جديد: ${title}`,
          body: `${REPORT_KIND_LABELS[kind as keyof typeof REPORT_KIND_LABELS] ?? "تقرير"} — بانتظار مراجعة العميل`,
          link: "/dashboard",
        });
      } catch (e) {
        console.warn("[save_report] تعذّر إشعار الإدارة:", e instanceof Error ? e.message : e);
      }
      return {
        result: { ok: true, report_id: id, status: "pending_review",
          note: "حُفظ التقرير في حساب العميل بانتظار مراجعته. أبلغ العميل أنه يستطيع مراجعته وإقراره من صفحة التقارير" },
        display: `__REPORT_SAVED__${JSON.stringify({ id, kind, title })}`,
      };
    }

    case "get_workflow_options": {
      const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));
      const [st, ac, ro] = await Promise.all([
        erpGET(`/api/resource/Workflow State?fields=${q(["name"])}&limit_page_length=0`),
        erpGET(`/api/resource/Workflow Action Master?fields=${q(["name"])}&limit_page_length=0`),
        erpGET(`/api/resource/Role?fields=${q(["name"])}&limit_page_length=0`),
      ]);
      const names = (r: unknown) => ((r as { data?: { name: string }[] })?.data ?? []).map(x => x.name);
      return {
        result: { states: names(st), actions: names(ac), roles: names(ro),
          note: "أسماء الحالات والإجراءات غير الموجودة تُنشأ تلقائياً عند create_workflow، أما الأدوار فلا — استخدم دوراً من هذه القائمة" },
        display: "",
      };
    }

    case "get_workflows": {
      const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));
      const dt = (args.document_type as string | undefined)?.trim();
      const filters = dt ? `&filters=${q([["document_type", "=", dt]])}` : "";
      const res = await erpGET(`/api/resource/Workflow?fields=${q(["name", "document_type", "is_active", "workflow_state_field"])}${filters}&limit_page_length=0`);
      const list = ((res as { data?: unknown[] })?.data ?? []);
      return { result: { count: list.length, workflows: list }, display: "" };
    }

    case "create_workflow": {
      if (!args.confirmed) {
        return { result: { ok: false, needs_confirmation: true,
          message: "اعرض تصميم دورة العمل على العميل (الحالات والانتقالات والأدوار) واحصل على موافقته الصريحة، ثم أعد الاستدعاء بـ confirmed: true" }, display: "" };
      }
      const name = String(args.workflow_name ?? "").trim();
      const docType = String(args.document_type ?? "").trim();
      const states = (args.states ?? []) as Array<{ state: string; allow_edit: string; doc_status: string }>;
      const transitions = (args.transitions ?? []) as Array<{ state: string; action: string; next_state: string; allowed: string }>;
      if (!name || !docType || !states.length || !transitions.length) {
        return { result: { ok: false, error: "الاسم ونوع المستند وحالة واحدة وانتقال واحد على الأقل مطلوبة" }, display: "" };
      }

      const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));
      const existing = await erpGET(`/api/resource/Workflow?filters=${q([["document_type", "=", docType]])}&fields=${q(["name"])}&limit_page_length=1`);
      if (((existing as { data?: unknown[] })?.data ?? []).length) {
        return { result: { ok: false, error: `يوجد بالفعل دورة عمل لنوع المستند ${docType} — راجعها بـ get_workflows قبل إنشاء أخرى` }, display: "" };
      }

      // الحالات والإجراءات روابط لسجلات قائمة: اسم غير موجود يُفشل الحفظ كله.
      // ننشئها أولاً — إنشاء تسمية إعدادٍ لا حركة، وهو داخل نطاق الخبير.
      const ensure = async (doctype: string, values: string[], extra: Record<string, unknown> = {}) => {
        const present = new Set(((await erpGET(`/api/resource/${encodeURIComponent(doctype)}?fields=${q(["name"])}&limit_page_length=0`)) as { data?: { name: string }[] })?.data?.map(x => x.name) ?? []);
        const created: string[] = [];
        for (const v of Array.from(new Set(values)).filter(v => v && !present.has(v))) {
          await erpPOST(`/api/resource/${encodeURIComponent(doctype)}`, { [doctype === "Workflow State" ? "workflow_state_name" : "workflow_action_name"]: v, ...extra });
          created.push(v);
        }
        return created;
      };
      const newStates = await ensure("Workflow State", [...states.map(s => s.state), ...transitions.flatMap(t => [t.state, t.next_state])]);
      const newActions = await ensure("Workflow Action Master", transitions.map(t => t.action));

      const created = await erpPOST("/api/resource/Workflow", {
        workflow_name: name,
        document_type: docType,
        // الحقل القياسي الذي يخزّن فيه Frappe حالة المستند
        workflow_state_field: "workflow_state",
        is_active: 1,
        states: states.map(s => ({ state: s.state, allow_edit: s.allow_edit, doc_status: String(s.doc_status ?? "0") })),
        transitions: transitions.map(t => ({ state: t.state, action: t.action, next_state: t.next_state, allowed: t.allowed })),
      });
      const wfName = (created as { data?: { name?: string } })?.data?.name ?? name;
      return {
        result: { ok: true, workflow: wfName, document_type: docType,
          states_created: newStates, actions_created: newActions,
          note: "دورة العمل مفعّلة. المستندات الجديدة من هذا النوع ستتبعها؛ المستندات القائمة لا تتأثر بأثر رجعي" },
        display: `__WORKFLOW_CREATED__${JSON.stringify({ name: wfName, document_type: docType, states: states.map(s => s.state), transitions: transitions.length })}`,
      };
    }

    case "check_tax_setup": {
      const setup = await inspectTaxSetup();
      if (setup.ok) {
        return {
          result: {
            configured: true,
            template: setup.template,
            rates: setup.taxRows.map(r => r.rate),
            company_tax_id: setup.companyTaxId ?? null,
            note: setup.companyTaxId ? undefined : "قالب الضريبة سليم لكن الرقم الضريبي للشركة غير مسجّل — أبلغ العميل واطلب موافقته على تسجيله",
          },
          display: "",
        };
      }
      return { result: { configured: false, ...setup }, display: "" };
    }
    case "setup_tax_settings": {
      // الموافقة الصريحة شرط مُنفَّذ في الكود، لا مجرد تعليمات للوكيل
      if (args.confirmed !== true) {
        return { result: { error: "مطلوب موافقة العميل الصريحة أولاً — أبلغه بما هو ناقص في إعدادات الضريبة واطلب إذنه، ثم استدعِ الأداة بـ confirmed: true" }, display: "" };
      }
      const rate = Number(args.rate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
        return { result: { error: "نسبة ضريبة غير صالحة — اسأل العميل عن النسبة المطبقة في بلده" }, display: "" };
      }
      const done: string[] = [];

      // الشركة الحالية
      const compList = await erpGET(`/api/resource/Company?limit=1&fields=${encodeURIComponent(JSON.stringify(["name", "tax_id", "abbr"]))}`) as { data?: Array<{ name: string; tax_id?: string; abbr?: string }> };
      const comp = compList?.data?.[0];
      if (!comp) return { result: { error: "لم يُعثر على شركة في النظام" }, display: "" };

      // 1) تسجيل الرقم الضريبي للشركة إن أُعطي — بعد التحقق من صيغته
      if (args.company_tax_id) {
        const check = await checkTaxIdForCompanyCountry(String(args.company_tax_id));
        if (!check.valid) {
          return { result: { needs_clarification: true, reason: "invalid_tax_id", provided: String(args.company_tax_id), problem: check.reason, message: "الرقم الضريبي للشركة غير صحيح الصيغة — أبلغ العميل بالمشكلة واطلب الرقم الصحيح" }, display: "" };
        }
        await erpPUT(`/api/resource/Company/${encodeURIComponent(comp.name)}`, { tax_id: check.normalized });
        done.push(`سُجّل الرقم الضريبي للشركة: ${check.normalized}`);
      }

      // إن كان قالب الضريبة سليماً بالفعل ولم يكن الناقص إلا الرقم الضريبي، لا نُنشئ قالباً مكرراً
      const existing = await inspectTaxSetup();
      if (existing.ok) {
        return {
          result: { success: true, template: existing.template, already_configured: true, done },
          display: `__TAX_SETUP_DONE__${JSON.stringify({ template: existing.template, rate: (existing.taxRows[0]?.rate as number) ?? rate, account_head: (existing.taxRows[0]?.account_head as string) ?? "", done: [...done, `قالب الضريبة "${existing.template}" مضبوط بالفعل — لم يُنشأ قالب جديد`] })}`,
        };
      }

      // 2) حل الحساب الضريبي (أو استخدام ما حدده العميل)
      let accountHead = args.account_head ? String(args.account_head) : null;
      if (!accountHead) {
        const accFilters = encodeURIComponent(JSON.stringify([["is_group", "=", 0], ["root_type", "=", "Liability"]]));
        const accData = await erpGET(`/api/resource/Account?limit=50&fields=${encodeURIComponent(JSON.stringify(["name", "account_type"]))}&filters=${accFilters}`) as { data?: Array<{ name: string; account_type?: string }> };
        const accounts = accData?.data ?? [];
        accountHead = accounts.find(a => a.account_type === "Tax" && /vat|ضريب/i.test(a.name))?.name
          ?? accounts.find(a => a.account_type === "Tax")?.name
          ?? accounts.find(a => /vat|ضريب/i.test(a.name))?.name
          ?? null;
        if (!accountHead) {
          return {
            result: {
              needs_clarification: true, reason: "no_tax_account_found",
              message: "لم أجد حساباً ضريبياً في شجرة الحسابات — اسأل العميل عن الحساب الذي يريد ترحيل الضريبة إليه",
              available: accounts.map(a => a.name).slice(0, 25),
            },
            display: "",
          };
        }
      }

      // 3) إنشاء قالب ضريبة المبيعات وتعيينه افتراضياً
      const templateName = `ضريبة القيمة المضافة ${rate}%`;
      const tplDoc = {
        title: templateName,
        company: comp.name,
        is_default: 1,
        taxes: [{
          charge_type: "On Net Total",
          account_head: accountHead,
          rate,
          description: `ضريبة القيمة المضافة ${rate}%`,
        }],
      };
      const created = await erpPOST("/api/resource/Sales%20Taxes%20and%20Charges%20Template", tplDoc) as { data?: { name?: string } };
      const createdName = created?.data?.name ?? templateName;
      done.push(`أُنشئ قالب ضريبة "${createdName}" بنسبة ${rate}% على حساب "${accountHead}" وعُيّن افتراضياً`);

      return {
        result: { success: true, template: createdName, rate, account_head: accountHead, done },
        display: `__TAX_SETUP_DONE__${JSON.stringify({ template: createdName, rate, account_head: accountHead, done })}`,
      };
    }
    case "get_settings": {
      const settingsType = args.settings_type as string;
      const recName = args.name as string | undefined;
      if (SINGLE_DOCTYPES.has(settingsType)) {
        const data = await erpGET(`/api/resource/${encodeURIComponent(settingsType)}/${encodeURIComponent(settingsType)}`) as { data: Record<string, unknown> };
        return { result: data?.data, display: "" };
      }
      if (recName) {
        const data = await erpGET(`/api/resource/${encodeURIComponent(settingsType)}/${encodeURIComponent(recName)}`) as { data: Record<string, unknown> };
        return { result: data?.data, display: "" };
      }
      // بدون اسم: أعد قائمة السجلات المتاحة (شركات أو قوالب ضرائب)
      const listData = await erpGET(`/api/resource/${encodeURIComponent(settingsType)}?limit=20`) as { data: Array<{ name: string }> };
      return { result: { available: (listData?.data ?? []).map(r => r.name), hint: "استخدم get_settings مع name لقراءة تفاصيل سجل محدد" }, display: "" };
    }
    case "update_settings": {
      const settingsType = args.settings_type as string;
      const recName = args.name as string | undefined;
      const fields = args.fields as Record<string, unknown>;
      if (!fields || Object.keys(fields).length === 0) {
        return { result: { error: "لم تُحدد أي حقول للتعديل" }, display: "" };
      }
      let path: string;
      if (SINGLE_DOCTYPES.has(settingsType)) {
        path = `/api/resource/${encodeURIComponent(settingsType)}/${encodeURIComponent(settingsType)}`;
      } else {
        if (!recName) {
          // حاول الحصول على السجل الوحيد تلقائياً (مثل الشركة الوحيدة)
          const listData = await erpGET(`/api/resource/${encodeURIComponent(settingsType)}?limit=5`) as { data: Array<{ name: string }> };
          const records = listData?.data ?? [];
          if (records.length === 1) {
            path = `/api/resource/${encodeURIComponent(settingsType)}/${encodeURIComponent(records[0].name)}`;
          } else {
            return { result: { needs_clarification: true, reason: "specify_record_name", available: records.map(r => r.name) }, display: "" };
          }
        } else {
          path = `/api/resource/${encodeURIComponent(settingsType)}/${encodeURIComponent(recName)}`;
        }
      }
      const data = await erpPUT(path, fields) as { data: Record<string, unknown> };
      return {
        result: { updated: true, settings_type: settingsType, changed_fields: Object.keys(fields), data: data?.data ? Object.fromEntries(Object.keys(fields).map(k => [k, (data.data as Record<string, unknown>)[k]])) : undefined },
        display: `__SETTINGS_UPDATED__${JSON.stringify({ settings_type: settingsType, name: recName ?? settingsType, changed: Object.keys(fields) })}`,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── نماذج الطباعة: قراءة النموذج الافتراضي المضبوط في نظام العميل ───────────
// ERPNext يخزّن النموذج الافتراضي لكل DocType في Property Setter (وهو ما تكتبه
// واجهة "Print Settings / Default Print Format")، وأحياناً في حقل على DocType نفسه.
// نقرأه صراحةً ونطبع به بالاسم، بدل الاعتماد على استنتاج ERPNext الضمني.
const printFormatCache = new Map<string, { candidates: Array<string | undefined>; expiry: number }>();
const PRINT_FORMAT_CACHE_TTL = 10 * 60 * 1000;

async function resolvePrintFormatCandidates(doctype: string): Promise<Array<string | undefined>> {
  const cacheKey = `${erpBaseUrl()}|${doctype}`;
  const cached = printFormatCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.candidates;

  const ordered: Array<string | undefined> = [];
  const push = (v?: string | null) => {
    if (v && !ordered.includes(v)) ordered.push(v);
  };

  try {
    // 1) النموذج الافتراضي الذي ضبطه العميل من إعدادات الـ DocType
    const psFilters = encodeURIComponent(JSON.stringify([["doc_type", "=", doctype], ["property", "=", "default_print_format"]]));
    const ps = await erpGET(`/api/resource/Property%20Setter?filters=${psFilters}&fields=${encodeURIComponent(JSON.stringify(["value"]))}&limit=1`) as { data?: Array<{ value?: string }> };
    push(ps?.data?.[0]?.value);
  } catch (e) {
    console.warn("[printFormat] Property Setter lookup failed:", e instanceof Error ? e.message : e);
  }

  try {
    // 2) الحقل default_print_format على الـ DocType نفسه (بعض التنصيبات تضبطه هنا)
    const dt = await erpGET(`/api/resource/DocType/${encodeURIComponent(doctype)}`) as { data?: { default_print_format?: string } };
    push(dt?.data?.default_print_format);
  } catch { /* غير حرج */ }

  try {
    // 3) بدائل مناسبة من نماذج الطباعة المتاحة لنفس الـ DocType — نفضّل الأقرب
    //    اسماً للـ DocType (مثل "Sales Invoice Print") ونستبعد نماذج الطباعة الخام (raw)
    const pfFilters = encodeURIComponent(JSON.stringify([["doc_type", "=", doctype], ["disabled", "=", 0], ["raw_printing", "=", 0]]));
    const pfFields = encodeURIComponent(JSON.stringify(["name", "print_format_type"]));
    const pf = await erpGET(`/api/resource/Print%20Format?filters=${pfFilters}&fields=${pfFields}&limit=50`) as { data?: Array<{ name: string; print_format_type?: string }> };
    const usable = (pf?.data ?? []).filter(f => f.print_format_type !== "JS");
    for (const f of usable.filter(f => f.name.startsWith(doctype))) push(f.name);
    for (const f of usable) push(f.name);
  } catch (e) {
    console.warn("[printFormat] Print Format list lookup failed:", e instanceof Error ? e.message : e);
  }

  // 4) آخر الحلول: نموذج "Standard" المتوفر في كل تنصيب ERPNext
  push("Standard");

  printFormatCache.set(cacheKey, { candidates: ordered, expiry: Date.now() + PRINT_FORMAT_CACHE_TTL });
  return ordered;
}

// ─── Agent Router ─────────────────────────────────────────────────────────────
export const agentRouter = router({
  chat: protectedProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant", "tool"]),
        // المتصفح يرسل التاريخ كاملاً والخصم نقطة واحدة مهما كبر، فبلا سقف
        // يستطيع أي عميل تحميل الحساب تكلفة نموذج ضخمة مقابل نقطة.
        content: z.string().max(MAX_MESSAGE_CHARS, `أقصى طول للرسالة ${MAX_MESSAGE_CHARS} حرف`),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        })).optional(),
      })).max(MAX_MESSAGES, "المحادثة طويلة جداً — ابدأ محادثة جديدة"),
    }))
    .mutation(async ({ input, ctx }) => {
      // ─── خصم رصيد الرسالة — من رصيد المنظمة المشترك ───
      // الرسالة الطويلة بنقطتين: التكلفة الفعلية يحكمها البرومبت الثابت لا نص
      // العميل، لكن السقف يمنع أن تمر رسالة ضخمة بسعر رسالة عادية.
      const credits = await import("../credits");
      const lastUserContent = [...input.messages].reverse().find(m => m.role === "user")?.content ?? "";
      const messageCost = messageCreditCost(lastUserContent);
      try {
        if (ctx.effectiveUserId) {
          await credits.deductCredits(ctx.effectiveUserId, messageCost, "message",
            messageCost > 1 ? "رسالة طويلة للوكيل الذكي" : "رسالة للوكيل الذكي");
        }
      } catch (e) {
        if (e instanceof credits.InsufficientCreditsError) {
          const { TRPCError } = await import("@trpc/server");
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        // إن تعذّر الاتصال بقاعدة البيانات لا نمنع المحادثة
        console.warn("[agent.chat] credits deduction skipped:", e instanceof Error ? e.message : e);
      }
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

      // ─── رؤى "المدير المالي" (تحليل استراتيجي وتوصيات تطوعية) حصرية للباقة المؤسسية (hasDirectSupport) ───
      let hasCfoSkill = false;
      let agentMode: AgentMode = "accounting";
      try {
        if (ctx.effectiveUserId) {
          const sub = await dbHelpers.getSubscriptionByUserId(ctx.effectiveUserId);
          if (sub) {
            const plan = await dbHelpers.getPlanById(sub.planId);
            hasCfoSkill = plan?.hasDirectSupport ?? false;
            // الوضع يُشتق من الباقة. الفشل يُبقيه "accounting" — وهو الوضع
            // الأوسع صلاحية، فلا يُحرم عميل من أدواته بسبب تعذّر قراءة باقته.
            if (plan?.mode === "expert") agentMode = "expert";
          }
        }
      } catch (e) {
        console.warn("[agent.chat] failed to resolve plan tier for persona:", e instanceof Error ? e.message : e);
      }

      const identityLine = identityLineFor(agentMode, hasCfoSkill);

      const SYSTEM = `أنت "المعاصر AI" — خبير مالي متعدد الأدوار ومساعد ذكاء اصطناعي متخصص في نظام Almoaser AI ERP (المبني على Frappe). ${identityLine}

## هويتك المهنية
لديك خبرة 15+ عاماً في المحاسبة المالية والإدارية والإدارة المالية، وأنت خبير معتمد في Almoaser AI ERP. تتقن:
- معايير المحاسبة الدولية (IFRS) والمحاسبة العربية
- دورة حياة المستندات (Draft → Submitted → Cancelled)
- جميع DocTypes الرئيسية: Sales Invoice, Purchase Invoice, Journal Entry, Payment Entry, Customer, Supplier, Item, Account, Stock Entry
- مبدأ القيد المزدوج (Double Entry): كل عملية لها مدين ودائن متساويان
- الميزانية العمومية، قائمة الدخل، التدفقات النقدية، ميزان المراجعة
- ضريبة القيمة المضافة (VAT) وأحكامها في دول الخليج
- إدارة المخزون بطرق FIFO وWeighted Average
- مراكز التكلفة (Cost Centers) وإدارة المشاريع

${buildExpertSkillsSection(hasCfoSkill)}

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
14. **ضريبة القيمة المضافة (VAT)**: الضريبة تأتي **جاهزة من إعدادات نظام العميل** — create_invoice تطبّق قالب الضريبة الافتراضي (Sales Taxes and Charges Template) تلقائياً دون أي إعداد منك. لا تحسب الضريبة يدوياً ولا تضفها كصنف. الأسعار المُمررة rate هي قبل الضريبة، والنظام يحتسب النسبة ويظهرها في الفاتورة. إن طلب المستخدم فاتورة بدون ضريبة/معفاة → apply_vat: false. عند إخبار المستخدم بإجمالي الفاتورة اذكر: الإجمالي قبل الضريبة، الضريبة، والمجموع شامل الضريبة
14أ. **إعدادات الضريبة غير المضبوطة — إبلاغ ثم موافقة (مهم)**: إذا أعادت create_invoice نتيجة needs_clarification بسبب tax_settings_not_configured، أو أظهرت check_tax_setup نقصاً: **لا تُصدر الفاتورة بدون ضريبة بصمت أبداً**. بدلاً من ذلك: 1) أبلغ العميل بوضوح بما هو ناقص بالتحديد (من حقل missing) وأثره — "فاتورتك لن تكون فاتورة ضريبية نظامية بدون هذا" 2) اسأله عن نسبة الضريبة المطبقة في بلده إن لم تكن معروفة (15% السعودية، 14% مصر، 5% الإمارات) وعن الرقم الضريبي للشركة إن كان ناقصاً 3) **اطلب موافقته الصريحة**: "هل تسمح لي أضبط لك إعدادات الضريبة الآن؟" 4) بعد موافقته فقط، استدعِ setup_tax_settings مع confirmed: true 5) ثم أعد إنشاء الفاتورة. الأداة نفسها ترفض التنفيذ بدون confirmed: true — فلا تحاول تجاوز خطوة الموافقة. إن رفض العميل، أخبره أن الفاتورة ستُصدر بدون ضريبة وانتظر تأكيده على ذلك (apply_vat: false)
15. **الرقم الضريبي للعملاء (إلزامي لا اختياري)**: أي عميل من نوع شركة/مؤسسة **يجب** أن يكون له رقم ضريبي مسجّل قبل إصدار أي فاتورة مبيعات له. عند إنشاء عميل جديد اسأل عن الرقم الضريبي وامرّره في tax_id فوراً. إن حاولت إنشاء فاتورة مبيعات لعميل شركة بلا رقم ضريبي، ستُعيد create_invoice نتيجة needs_clarification بسبب missing_tax_id — عندها **توقف واسأل المستخدم عن الرقم الضريبي صراحةً**، سجّله بـ update_document (Customer، fields: {tax_id: "..."})، ثم أعد محاولة إنشاء الفاتورة. لا تنشئ الفاتورة بدون الرقم الضريبي ولا تتجاوز هذا الشرط إلا إذا أكّد المستخدم صراحةً أن العميل فرد (Individual) لا يملك سجلاً تجارياً
16. **ترتيب أسئلة إنشاء الفاتورة**: عندما يطلب العميل تسجيل فاتورة ولم يُعطِ كل التفاصيل دفعة واحدة، اسأل بالترتيب التالي (سؤالاً واحداً في كل مرة، لا تسأل كل الأسئلة دفعة واحدة): 1) اسم العميل — ثم تحقق من الرقم الضريبي المسجل له (راجع قاعدة 15) 2) الصنف أو الخدمة 3) الكمية 4) السعر. إذا ذكر المستخدم بعض التفاصيل مسبقاً في رسالته، لا تعد سؤالها، واسأل فقط عمّا تبقّى بنفس الترتيب
16أ. **التحقق من الرقم الضريبي**: النظام يتحقق تلقائياً من **صيغة** الرقم الضريبي حسب بلد الشركة (السعودية: 15 رقماً تبدأ وتنتهي بـ 3 — وفق متطلبات هيئة الزكاة والضريبة؛ مصر: 9 أرقام؛ الإمارات: 15 رقماً تبدأ بـ 100)، ويرفض الأرقام المستحيلة أو المفبركة بشكل واضح (كل الخانات متطابقة، أو أرقام متسلسلة). إن أعادت الأداة invalid_tax_id → أبلغ العميل بالمشكلة المحددة (حقل problem) واطلب الرقم الصحيح. **مهم جداً — لا تدّعِ أبداً أنك "تحققت من الرقم لدى هيئة الزكاة" أو أنه "مسجّل رسمياً"**: لا توجد واجهة برمجية رسمية من الهيئة للتحقق من التسجيل الفعلي، وخدمة التحقق على بوابتها يدوية فقط. أقصى ما نؤكده هو مطابقة الصيغة. إن سأل العميل عن التأكد النهائي، أرشده لبوابة الهيئة (zatca.gov.sa ← الخدمات الإلكترونية ← التحقق من المنشآت المسجلة في ضريبة القيمة المضافة)
17. **متطلبات الفوترة الإلكترونية حسب البلد**: قبل إنشاء أول فاتورة لعميل جديد، تحقق من بلد الشركة (get_settings على Company — الحقل country) إن لم تكن متأكداً منه بالفعل في هذه المحادثة. في السعودية: الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3 (قاعدة ZATCA) وهذا محقق تلقائياً عبر تنسيق النظام. في مصر أو أي دولة أخرى لها منظومة فوترة إلكترونية إلزامية (مثل منظومة الفاتورة الإلكترونية المصرية ETA)، لا تفترض صيغة الرقم الضريبي — اسأل المستخدم صراحةً: "هل عميلك مسجّل في منظومة الفوترة الإلكترونية في بلدكم؟ ما رقم تسجيله الضريبي؟" وسجّل ما يقوله دون التحقق من صيغة محددة. الهدف: لا تُصدر فاتورة لعميل شركة دون رقم ضريبي مسجل أياً كان بلد الشركة
## صلاحياتك الكاملة في النظام
أنت تملك صلاحيات كاملة للإدخال والتسجيل والاعتماد والتعديل والإلغاء والحذف في كل وحدات النظام (ضمن صلاحيات مستخدم ERPNext المتصل):
- **المبيعات**: فواتير مبيعات (إنشاء/عرض/اعتماد/تعديل/إلغاء/حذف)، عملاء (بحث/إنشاء/تعديل/حذف)
- **المشتريات**: فواتير مشتريات (create_purchase_invoice/get_purchase_invoices)، موردين (get_suppliers/create_supplier) — نفس قاعدة منع التكرار تنطبق على الموردين
- **التعديل والحذف الشامل**: update_document (تعديل أي حقل في فاتورة مسودة/عميل/مورد/صنف/قيد/دفعة)، cancel_document (إلغاء مستند معتمد)، delete_document (حذف نهائي مع إلغاء تلقائي للمعتمد) — أمثلة: "عدّل رقم جوال العميل محمود" → find_customer ثم update_document | "غيّر سعر صنف الاستشارة إلى 500" → find_item ثم update_document | "احذف الفاتورة SINV-0042" → تأكيد ثم delete_document | "ألغِ القيد JV-0010" → تأكيد ثم cancel_document
- **الدفعات**: create_payment_entry — تسجيل قبض من عميل (Receive) أو صرف لمورد (Pay)، مع إمكانية ربط الدفعة بفاتورة محددة لسدادها (reference_invoice). عند قول المستخدم "سجّل دفعة/سداد/قبض/تحصيل من عميل" → Receive، "دفعنا/سددنا لمورد" → Pay. طريقة الدفع (mode_of_payment) اختيارية وتُحل تلقائياً بمطابقة ذكية مع طرق الدفع المسجلة في النظام (نقد/شيك/حوالة مصرفية...) — إن أعادت الأداة needs_clarification مع available_modes فاعرضها على المستخدم ليختار. لا تتوقف عن تسجيل الدفعة بحجة الإعدادات — الحسابات الافتراضية تُجلب تلقائياً من إعدادات الشركة
- **قيود اليومية**: create_journal_entry — قيد مزدوج (مدين/دائن متساويان). قبل إنشاء القيد ابحث عن أسماء الحسابات الفعلية بـ get_accounts (الأسماء تتضمن اختصار الشركة مثل "Cash - X"). مثال: "سجل قيد: مدين الصندوق 3000 دائن المبيعات 3000" → get_accounts للصندوق والمبيعات ثم create_journal_entry
- **سير سداد فاتورة**: "سجل سداد فاتورة SINV-XXX" → get_invoice_detail لمعرفة العميل والمبلغ المتبقي → create_payment_entry مع reference_invoice → اعرض الاعتماد
- **إعدادات النظام لكافة الموديولات والمستندات**: get_settings لقراءة أي DocType إعدادات وupdate_settings لتعديله — يشمل ذلك بيانات الشركة، إعدادات البيع/الشراء/المخزون/الحسابات/النظام، قوالب الضرائب، **طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق**، POS Profile، شروط الدفع، السنة المالية، مراكز التكلفة، المستودعات، وأي DocType آخر. أمثلة: "حدّث الرقم الضريبي للشركة" → update_settings(Company, {tax_id}) | "اربط طريقة الدفع نقدي بحساب الصندوق" → get_settings(Mode of Payment, name) لقراءة الوضع الحالي ثم update_settings(Mode of Payment, name, {accounts: [{company, default_account}]}) — ابحث عن اسم الحساب الفعلي بـ get_accounts أولاً | "غيّر العملة الافتراضية" → update_settings(Global Defaults). قبل أي تعديل إعدادات اقرأ القيم الحالية ولخّص التغيير للمستخدم

## قاعدة عدم الرفض الاستباقي (مهم جداً)
صلاحياتك في النظام هي **نفس صلاحيات مستخدم ERPNext المتصل بالكامل** — لا توجد لديك قيود إضافية. **يُمنع منعاً باتاً** أن ترفض طلب إعدادات أو تعديل بحجة أنك "تحتاج صلاحيات مسؤول النظام" أو "هذا يتجاوز صلاحياتك" قبل المحاولة الفعلية. القاعدة: **نفّذ دائماً عبر الأداة المناسبة**، وإن أعاد ERPNext خطأ صلاحيات (PermissionError) فعندها فقط انقل رسالة الخطأ للمستخدم واقترح الحل. أي طلب لتهيئة أو تعديل إعدادات أي موديول أو مستند (طرق الدفع، الحسابات الافتراضية، الضرائب، الشركة، الطباعة...) هو ضمن نطاق عملك المباشر.

**طلب طباعة/تنزيل/إرسال مستند:** إذا طلب العميل طباعة فاتورة أو تنزيل PDF أو "ابعتهالي" أو إرسال نسخة من أي مستند — استخدم أداة print_document فوراً، ولا تعتذر أبداً بعدم امتلاك صلاحية أو قدرة على الطباعة أو إرسال الملفات. الأداة تُصدر الملف فعلياً من نظام العميل **بنموذج الطباعة الافتراضي المضبوط عنده** وتسلّمه داخل المحادثة جاهزاً للفتح والتحميل — فلا تكتفِ بإعطاء رقم المستند أو بوصف كيفية طباعته يدوياً من النظام.
**بعد إنشاء أي فاتورة بنجاح — سير الاعتماد ثم الطباعة (مهم):** الفاتورة تُنشأ **مسودة**، والنموذج الرسمي في نظام العميل يحتوي غالباً رمز QR الضريبي الذي **لا يُولَّد إلا بعد الاعتماد** — فطباعة المسودة تخرج بشكل عام غير رسمي. لذلك بعد الإنشاء:
1. أبلغ العميل أن الفاتورة أُنشئت كمسودة مع رقمها وإجماليها.
2. **اطلب تأكيده الصريح على الاعتماد**، واشرح الأثر بوضوح: "الاعتماد يسجّل الفاتورة رسمياً في الحسابات ويصدرها بالشكل الضريبي المعتمد — هل أعتمدها؟" وأضف أزرار إجابة سريعة (نعم اعتمدها / لا اتركها مسودة).
3. **بعد موافقته فقط**: استدعِ submit_document ثم print_document فوراً لتصل النسخة الرسمية.
4. إن رفض أو أراد إبقاءها مسودة، لا تعتمدها. ولو طلب طباعتها كمسودة، اطبعها ونبّهه أنها ستخرج بالشكل العام لأنها غير معتمدة.
**لا تعتمد أي فاتورة تلقائياً دون تأكيد صريح من العميل** — الاعتماد يرحّل قيوداً محاسبية ولا يمكن التراجع عنه إلا بالإلغاء.

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

## أزرار الإجابات السريعة (Quick Replies) — إلزامي
كلما طرحت على المستخدم سؤالاً (تأكيد، استيضاح، اختيار بين مرشحين، اعتماد مستند، حذف/إلغاء...) يجب أن تُنهي ردّك بسطر أخير منفصل بهذه الصيغة بالضبط:
[QUICK_REPLIES: خيار 1 | خيار 2 | خيار 3]
قواعده:
- الخيارات نصوص قصيرة (كلمة إلى 4 كلمات) يستطيع المستخدم إرسالها كما هي دون كتابة، بنفس لغة المحادثة
- من 2 إلى 4 خيارات، ورتّب الإجابة الأرجح أولاً
- أمثلة: سؤال اعتماد فاتورة → [QUICK_REPLIES: نعم، اعتمدها | لا، اتركها مسودة]
  سؤال تأكيد حذف → [QUICK_REPLIES: نعم، احذفها نهائياً | لا، تراجع]
  اختيار بين عملاء متشابهين → [QUICK_REPLIES: شركة النور للتجارة | شركة النور للمقاولات | عميل جديد]
  سؤال عن بيانات ناقصة بخيارات محتملة → اقترح قيماً منطقية كخيارات
- لا تضع السطر إذا كان ردّك خبرياً لا يتطلب إجابة من المستخدم
- لا تذكر هذا السطر أو صيغته في نص الرد أبداً — هو للواجهة فقط

## تاريخ اليوم
اليوم هو ${new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. استخدمه عند حساب التواريخ والفترات.

${modeRulesFor(agentMode)}`;

      const llmMessages: Array<{
        role: "system" | "user" | "assistant" | "tool";
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
      }> = [
        { role: "system", content: SYSTEM },
        // نرسل آخر نافذة من التاريخ لا التاريخ كله: كل استدعاء يعيد إرسال
        // السياق بالكامل، فمحادثة طويلة تضاعف تكلفة كل رسالة تالية فيها.
        // القصّ يقع عند رسالة user حتى لا تُيتَّم رسالة tool فيُرفض الطلب.
        ...trimHistory(input.messages).map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
      ];

      // لا نعرض على النموذج أدوات سيُرفض تنفيذها لهذا المستخدم أصلاً — لا بصلاحيات
      // المنصة ولا بصلاحياته في نظامه هو. تُحسب داخل سياق ERP أدناه.
      // الترتيب مقصود: وضع الباقة أولاً (حدّ المنتج)، ثم صلاحيات المنصة، ثم
      // صلاحيات نظام العميل. كل طبقة تضيّق ولا توسّع.
      let availableTools = toolsForUser(toolsForMode(TOOLS, agentMode), ctx.user);

      const toolResults: Array<{ tool_call_id: string; tool_name: string; display: string }> = [];

      // تشغيل كامل حلقة الوكيل ضمن سياق اتصال ERPNext الخاص بالمستخدم الحالي
      return runWithErpConfig(ctx.user.id, async () => {
      // ─── تضييق إضافي بصلاحيات المستخدم في نظامه هو ───────────────────────
      // مصدر الحقيقة لما يستطيعه العميل هو ERP الخاص به، لا جدولنا. الفشل هنا
      // يعود للتضييق السابق ولا يحجب شيئاً: النظام نفسه هو الحاجز عند التنفيذ.
      availableTools = await narrowToolsByErpPermissions(availableTools);
      for (let iter = 0; iter < 8; iter++) {
        let response;
        try {
          response = await invokeAgentLLM({
            messages: llmMessages,
            tools: availableTools,
            tool_choice: "auto",
            maxTokens: 2000,
          });
          void logLlmUsage({
            userId: ctx.effectiveUserId ?? ctx.user.id,
            provider: response._provider ?? "builtin",
            usage: response.usage,
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "LLM invocation failed";
          console.error("[agent.chat] invokeAgentLLM error:", errMsg);
          const quotaHit = /usage exhausted|insufficient_quota|412|429/i.test(errMsg);
          // السبب التقني للمدير فقط — العميل يرى رسالة عامة دون أي تفاصيل
          alertAdminsProviderFailure(quotaHit ? `نفاد رصيد مزود النموذج: ${errMsg}` : errMsg);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "عذراً، المساعد الذكي مشغول حالياً — يرجى المحاولة بعد قليل 🙏",
          });
        }

        const msg = response?.choices?.[0]?.message;
        if (!msg) {
          console.error("[agent.chat] empty LLM response:", JSON.stringify(response)?.slice(0, 500));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "أعاد النموذج الذكي استجابة فارغة — يرجى إعادة صياغة الطلب أو المحاولة مرة أخرى" });
        }

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          const rawReply = typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("")
              : "";
          const { text: replyText, quickReplies } = extractQuickReplies(rawReply);
          if (conversationId && replyText) {
            try {
              await dbHelpers.addMessage(conversationId, "assistant", replyText,
                toolResults.length || quickReplies.length
                  ? JSON.stringify({ toolResults, quickReplies })
                  : undefined);
            } catch { /* non-blocking */ }
          }
          return { reply: replyText, toolResults, quickReplies, conversationId };
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
            requireToolPermission(ctx.user, tc.function.name);
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const activeConfig = currentErpConfig();
            // print_document لا يلمس ERPNext/Odoo مباشرة — فقط يعرض للعميل زر تحميل PDF
            // (نفس نموذج الطباعة الفعلي في نظامه)، بغض النظر عن المزوّد
            const { result, display } = tc.function.name === "print_document"
              ? (() => {
                  const doc = { doctype: args.doctype as string, name: args.document_name as string };
                  return { result: doc, display: `__DOCUMENT_PRINT__${JSON.stringify(doc)}` };
                })()
              : activeConfig.provider === "odoo" && activeConfig.database
                ? await executeOdooTool(tc.function.name, args, activeConfig as ErpConfig & { database: string })
                : await executeTool(tc.function.name, args, { userId: ctx.effectiveUserId ?? ctx.user.id, conversationId });
            toolResult = JSON.stringify(result);
            displayData = display;
            // ─── خصم 5 نقاط لكل مستند ERP يُنشأ بنجاح (فاتورة/دفعة/قيد) — من رصيد المنظمة المشترك ───
            try {
              const DOC_TOOLS = new Set(["create_invoice", "create_purchase_invoice", "create_payment_entry", "create_journal_entry"]);
              const resObj = result as { error?: unknown; needs_clarification?: unknown; duplicate_prevented?: unknown } | null;
              const succeeded = resObj && typeof resObj === "object" && !resObj.error && !resObj.needs_clarification && !resObj.duplicate_prevented;
              if (DOC_TOOLS.has(tc.function.name) && succeeded && ctx.effectiveUserId) {
                await credits.deductCredits(ctx.effectiveUserId, credits.DOCUMENT_COST, "document", `إنشاء مستند (${tc.function.name})`).catch(() => {});
              }
            } catch { /* خصم النقاط لا يوقف التنفيذ */ }
            // إشعار داخل الموقع + push عند إنشاء/اعتماد فاتورة عبر الوكيل
            try {
              if (displayData.startsWith("__INVOICE_CREATED__")) {
                const inv = JSON.parse(displayData.slice("__INVOICE_CREATED__".length)) as { name?: string; customer?: string; grand_total?: number };
                notifyUser({
                  userId: ctx.user.id,
                  type: "invoice_created",
                  title: "فاتورة جديدة",
                  body: `أنشأ الوكيل الفاتورة ${inv.name ?? ""} للعميل ${inv.customer ?? ""} بقيمة ${inv.grand_total ?? ""}.`,
                  link: "/invoices",
                }).catch(() => {});
              } else if (displayData.startsWith("__INVOICE_SUBMITTED__")) {
                const inv = JSON.parse(displayData.slice("__INVOICE_SUBMITTED__".length)) as { name?: string; grand_total?: number };
                notifyUser({
                  userId: ctx.user.id,
                  type: "invoice_submitted",
                  title: "تم اعتماد فاتورة",
                  body: `اعتُمدت الفاتورة ${inv.name ?? ""} بقيمة ${inv.grand_total ?? ""} في النظام.`,
                  link: "/invoices",
                }).catch(() => {});
              }
            } catch { /* الإشعار لا يوقف التنفيذ */ }
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
            toolResults.length ? JSON.stringify({ toolResults, quickReplies: [] }) : undefined);
        } catch { /* non-blocking */ }
      }
      return { reply: "تم تنفيذ الطلب.", toolResults, quickReplies: [] as string[], conversationId };
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

  // يولّد PDF أي مستند (فاتورة مبيعات/مشتريات، دفعة، قيد يومية) من نموذج الطباعة
  // الافتراضي الفعلي المُعدّ في نظام العميل (ERPNext أو Odoo) — وليس نموذجاً ثابتاً
  // في تطبيقنا، حتى يطابق دائماً ما يراه العميل لو طبع من نظامه مباشرة
  // حالة المستند — لتعرف الواجهة إن كان مسودة (فتعرض زر الاعتماد بدل الطباعة)
  getDocumentStatus: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .query(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      const config = currentErpConfig();
      if (config.provider === "odoo" && config.database) {
        // Odoo: نستنتج الحالة من state عبر أدوات Odoo
        return { docstatus: null as number | null, provider: "odoo" as const };
      }
      const doc = await erpGET(`/api/resource/${encodeURIComponent(input.doctype)}/${encodeURIComponent(input.name)}`) as { data?: { docstatus?: number; grand_total?: number; status?: string } };
      return {
        docstatus: doc?.data?.docstatus ?? null,
        grandTotal: doc?.data?.grand_total ?? null,
        status: doc?.data?.status ?? null,
        provider: "erpnext" as const,
      };
    })),

  // اعتماد مستند من الواجهة — بعد تأكيد المستخدم صراحةً بالضغط على الزر
  submitDocument: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .mutation(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      requireToolPermission(ctx.user, "submit_document");
      try {
        const result = await submitDoc(input.doctype, input.name);
        return { success: true as const, name: result?.name ?? input.name, status: result?.status ?? null };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: translateErpError(e instanceof Error ? e.message : String(e)) });
      }
    })),

  getDocumentPdf: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .mutation(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      const config = currentErpConfig();
      if (config.provider === "odoo" && config.database) {
        const { getOdooDocumentPdf } = await import("../odooTools");
        const result = await getOdooDocumentPdf(config as ErpConfig & { database: string }, input.doctype, input.name);
        if ("error" in result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        return { ...result, fallbackReason: undefined as string | undefined };
      }
      const erpUrl = erpBaseUrl();
      const sid = await getSession();
      const buildUrl = (format?: string) =>
        `${erpUrl}/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(input.doctype)}&name=${encodeURIComponent(input.name)}&no_letterhead=0`
        + (format ? `&format=${encodeURIComponent(format)}` : "");

      // نقرأ اسم نموذج الطباعة الافتراضي المضبوط فعلياً في إعدادات الـ DocType عند العميل
      // ونطبع به صراحةً (بدل ترك ERPNext يستنتجه ضمنياً)، ثم نتدرّج في بدائل مناسبة عند فشله
      const candidates = await resolvePrintFormatCandidates(input.doctype);
      let res: Response | null = null;
      let usedFormat: string | undefined;
      const failures: string[] = [];
      for (const candidate of candidates) {
        const attempt = await fetch(buildUrl(candidate), { headers: { Cookie: `sid=${sid}` } });
        if (attempt.ok) { res = attempt; usedFormat = candidate ?? "(افتراضي النظام)"; break; }
        const body = await attempt.text().catch(() => "");
        failures.push(`${candidate ?? "(default)"} → ${attempt.status} ${body.slice(0, 200)}`);
      }
      if (!res) {
        console.error(`[getDocumentPdf] all print formats failed for ${input.doctype} ${input.name}:\n${failures.join("\n")}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "تعذّر توليد PDF المستند — فشل نموذج الطباعة المضبوط وكل البدائل. راجع نماذج الطباعة في نظامك، وتحقق أن wkhtmltopdf المثبّت على خادم ERPNext هو إصدار patched-qt المطلوب",
        });
      }
      // إن اضطررنا لنموذج بديل، نوضّح السبب للمستخدم بدل تسليم شكل عام دون تفسير.
      // السبب الأشيع: النموذج الرسمي يحتوي رمز QR الضريبي الذي لا يُولَّد إلا بعد
      // اعتماد المستند، فتفشل الطباعة على المسودة بخطأ "روابط صورة مكسورة".
      let fallbackReason: string | undefined;
      const requestedFormat = candidates[0];
      if (failures.length > 0) {
        console.warn(`[getDocumentPdf] ${input.doctype} ${input.name}: printed with "${usedFormat}" after ${failures.length} failed candidate(s):\n${failures.join("\n")}`);
        const firstFailure = failures[0] ?? "";
        const brokenImage = /broken image|صورة مكسورة/i.test(firstFailure);
        let isDraft = false;
        try {
          const doc = await erpGET(`/api/resource/${encodeURIComponent(input.doctype)}/${encodeURIComponent(input.name)}`) as { data?: { docstatus?: number } };
          isDraft = doc?.data?.docstatus === 0;
        } catch { /* غير حرج */ }
        fallbackReason = brokenImage && isDraft
          ? `النموذج الرسمي "${requestedFormat}" يتطلب اعتماد المستند أولاً (رمز QR الضريبي لا يُولَّد قبل الاعتماد)، فطُبع مؤقتاً بـ"${usedFormat}"`
          : `تعذّر استخدام النموذج الافتراضي "${requestedFormat}"، فطُبع بـ"${usedFormat}"`;
      }
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { pdfBase64: base64, filename: `${input.name}.pdf`, printFormat: usedFormat, fallbackReason };
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
        // invokeAgentLLM لا invokeLLM: الأخير يقصد OpenAI/المدمج مباشرة ويرمي
        // "OPENAI_API_KEY is not configured" — بقيّة المنصة انتقلت إلى
        // OpenRouter وبقي هذا المسار وحده على الإعداد القديم، فتعطّلت قراءة
        // الصور وحدها بينما الدردشة تعمل. الموديل الأول في القائمة يقبل الصور.
        response = await invokeAgentLLM({
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
// ─── إشعار المدير بأعطال مزود النموذج (مع منع التكرار خلال ساعة) ─────────────
let lastProviderAlertAt = 0;
function alertAdminsProviderFailure(technicalReason: string) {
  const now = Date.now();
  if (now - lastProviderAlertAt < 60 * 60 * 1000) return; // إشعار واحد كحد أقصى كل ساعة
  lastProviderAlertAt = now;
  notifyAdmins({
    type: "provider_error",
    title: "عطل في مزود النموذج الذكي — العملاء يتلقون رسالة انشغال",
    body: `السبب التقني: ${technicalReason.slice(0, 300)}\n\nإن كان السبب نفاد الرصيد: اشحن رصيد OpenAI من platform.openai.com/settings/organization/billing`,
    link: "/admin",
  }).catch(() => {});
}
