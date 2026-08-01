// ─── قراءة صلاحيات المستخدم من نظامه هو ───────────────────────────────────────
//
// كان للمنصة نموذج صلاحيات خاص بها (TOOL_PERMISSIONS) لا علاقة له بما يملكه
// المستخدم فعلاً في ERP الخاص به. والصحيح أن مصدر الحقيقة هو نظامه: من لا يملك
// إنشاء قيد يومية هناك يجب ألا يعرض عليه الوكيل إنشاءه هنا.
//
// **هذه طبقة إرشادية لا حاجز أمني.** نحن ندخل نظام العميل بحسابه هو، فERPNext
// يفرض صلاحياته عند كل استدعاء فعلي على أي حال. فائدة القراءة المسبقة أن الوكيل
// يتوقف عن أن يَعِد بإجراء ثم يصطدم بالرفض في منتصف المحادثة. ولأنها ليست
// الحاجز، فالفشل هنا يعود للسلوك السابق ولا يحجب شيئاً — حجبُ عميل عن أدواته
// بسبب تعثّر شبكة أسوأ من عرض أداة سيرفضها نظامه بنفسه.

export type DocPermRow = {
  parent: string;
  role: string;
  permlevel: number;
  read?: number; create?: number; write?: number; submit?: number; delete?: number;
};

export type DocAction = "read" | "create" | "write" | "submit" | "delete";
export type ErpCapabilities = {
  unrestricted: boolean;
  can: (doctype: string, action: DocAction) => boolean;
};

/**
 * أدوار تتجاوز جدول DocPerm في Frappe فلا صفوف لها فيه إطلاقاً.
 * لو حسبناها من الجدول وحده لخرج صاحبها بصفر صلاحيات — وهو في الواقع مدير النظام.
 */
export const ERP_SUPERUSER_ROLES = new Set(["System Manager", "Administrator"]);

/** الدوكتايبس التي تهم أدوات الوكيل */
export const RELEVANT_DOCTYPES = [
  "Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry",
  "Customer", "Supplier", "Item", "Account",
];

export function computeCapabilities(roles: string[], rows: DocPermRow[]): ErpCapabilities {
  if (roles.some(r => ERP_SUPERUSER_ROLES.has(r))) {
    return { unrestricted: true, can: () => true };
  }
  const owned = new Set(roles);
  // permlevel > 0 يخص صلاحيات الحقول لا المستند، فلا يمنح إنشاءً ولا تعديلاً
  const docLevel = rows.filter(r => r.permlevel === 0 && owned.has(r.role));
  return {
    unrestricted: false,
    can: (doctype, action) => docLevel.some(r => r.parent === doctype && r[action] === 1),
  };
}

// ─── الجلب من ERPNext مع تخزين مؤقت ──────────────────────────────────────────
// المفتاح يشمل اسم المستخدم لا الرابط وحده: على نفس النسخة قد يعمل أكثر من
// عميل بحسابات مختلفة، والتخزين بالرابط وحده يسرّب صلاحيات أحدهم للآخر.
const cache = new Map<string, { caps: ErpCapabilities; expiry: number }>();
const TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

export function cacheKey(url: string, username: string) {
  return `${url.replace(/\/+$/, "")}::${username}`;
}

/** للاختبارات ولإبطال التخزين عند تغيّر الاتصال */
export function clearErpPermissionsCache() { cache.clear(); }

export async function fetchErpCapabilities(params: {
  url: string; username: string; cookie: string;
}): Promise<ErpCapabilities | null> {
  const key = cacheKey(params.url, params.username);
  const hit = cache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.caps;

  const base = params.url.replace(/\/+$/, "");
  const get = async (path: string) => {
    const res = await fetch(base + path, {
      headers: { Cookie: params.cookie },
      // استدعاءان أمام كل رسالة دردشة: نظام بطيء يجب ألا يُبطئ المحادثة
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json() as Promise<{ data?: unknown }>;
  };

  try {
    const q = (o: unknown) => encodeURIComponent(JSON.stringify(o));
    const [userRes, permRes] = await Promise.all([
      get(`/api/resource/User/${encodeURIComponent(params.username)}?fields=${q(["roles"])}`),
      // الدوكتايبس كلها في طلب واحد — طلب لكل واحد يضيف ثماني رحلات لكل رسالة
      get(`/api/resource/DocPerm?filters=${q([["parent", "in", RELEVANT_DOCTYPES]])}`
        + `&fields=${q(["parent", "role", "permlevel", "read", "create", "write", "submit", "delete"])}`
        + `&limit_page_length=0&parent=DocType`),
    ]);
    const roles = (((userRes.data as { roles?: { role: string }[] } | undefined)?.roles) ?? []).map(r => r.role);
    const rows = (permRes.data as DocPermRow[] | undefined) ?? [];
    if (!roles.length) return null; // لا أدوار = قراءة غير موثوقة، نعود للسلوك السابق
    const caps = computeCapabilities(roles, rows);
    cache.set(key, { caps, expiry: Date.now() + TTL_MS });
    return caps;
  } catch (e) {
    console.warn("[erpPermissions] تعذّرت قراءة الصلاحيات من نظام العميل:",
      e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── ربط الأدوات بالدوكتايب والإجراء ─────────────────────────────────────────
// أي أداة غير مذكورة هنا لا تُقيَّد بصلاحيات ERP (إعدادات، طباعة، تقارير عامة).
export const TOOL_DOC_ACTION: Record<string, [doctype: string, action: DocAction]> = {
  get_invoices: ["Sales Invoice", "read"],
  get_invoice_detail: ["Sales Invoice", "read"],
  create_invoice: ["Sales Invoice", "create"],
  submit_invoice: ["Sales Invoice", "submit"],
  get_sales_report: ["Sales Invoice", "read"],
  get_purchase_invoices: ["Purchase Invoice", "read"],
  create_purchase_invoice: ["Purchase Invoice", "create"],
  get_payments: ["Payment Entry", "read"],
  create_payment_entry: ["Payment Entry", "create"],
  get_journal_entries: ["Journal Entry", "read"],
  create_journal_entry: ["Journal Entry", "create"],
  get_customers: ["Customer", "read"],
  create_customer: ["Customer", "create"],
  get_suppliers: ["Supplier", "read"],
  create_supplier: ["Supplier", "create"],
  get_items: ["Item", "read"],
  create_item: ["Item", "create"],
  get_accounts: ["Account", "read"],
};

/** هل يسمح نظام العميل لهذا المستخدم باستعمال هذه الأداة؟ */
export function erpAllowsTool(caps: ErpCapabilities, toolName: string): boolean {
  if (caps.unrestricted) return true;
  const entry = TOOL_DOC_ACTION[toolName];
  if (!entry) return true; // أداة لا تقابل دوكتايباً بعينه
  return caps.can(entry[0], entry[1]);
}
