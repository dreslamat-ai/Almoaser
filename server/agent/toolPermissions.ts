// ─── صلاحيات المستخدمين الفرعيين على أدوات الوكيل ─────────────────────────────
// مفصولة عن الراوتر لأنها قاعدة أمان تُقرأ وتُراجَع وحدها: من يدقّق "من يستطيع
// ماذا" لا ينبغي أن يقرأ ثلاثة آلاف سطر ليجدها.
import { TRPCError } from "@trpc/server";
import { parsePermissions } from "../organizations";
import type { MemberPermissions, User } from "../../drizzle/schema";
import { getErpConfigForUser } from "../erpConnection";
import { fetchErpCapabilities } from "../erpPermissions";
import { getErpSession } from "../erpConnection";
import { currentErpConfig } from "./erpClient";

export const TOOL_PERMISSIONS: Record<string, keyof MemberPermissions | null> = {
  get_invoices: "viewInvoices", get_invoice_detail: "viewInvoices",
  get_customers: null, get_items: null, get_suppliers: null,
  create_invoice: "createInvoices", submit_invoice: "createInvoices",
  create_customer: "createInvoices", create_item: "createInvoices", create_supplier: "createInvoices",
  update_customer: "createInvoices",
  request_custom_app: null,
  create_custom_field: "manageErpSettings",
  create_print_format: "manageErpSettings",
  get_sales_report: "viewInvoices",
  get_purchase_invoices: "viewInvoices", create_purchase_invoice: "createInvoices",
  get_payments: "viewInvoices", create_payment_entry: "managePayments",
  get_accounts: null, get_journal_entries: "viewInvoices", create_journal_entry: "manageJournalEntries",
  submit_document: "createInvoices",
  print_document: "viewInvoices",
  update_document: "createInvoices",
  cancel_document: "manageJournalEntries",
  delete_document: "manageErpSettings",
  delete_with_dependencies: "manageErpSettings",
  list_documents: "viewInvoices",
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

export function requireToolPermission(user: User, toolName: string): void {
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
export async function narrowToolsByErpPermissions<T extends { function: { name: string } }>(
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
