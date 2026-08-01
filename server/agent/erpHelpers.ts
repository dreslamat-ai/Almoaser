// ─── مساعدات ERPNext: البحث بالتشابه، الشركة، الضريبة، العناوين ─────────────
// مشتركة بين أدوات كثيرة، ومنطقها (تطبيع العربية، التشابه، إعادة المحاولة عند
// اختلاف مركز التكلفة) قائم بذاته ويستحق أن يُختبر بمعزل عن المنفّذ.
import { erpGET, erpPOST, erpPUT, erpBaseUrl, currentErpConfig, getSession } from "./erpClient";
import { validateTaxId } from "../taxId";
import { inspectCustomerCompleteness, type CustomerDoc, type AddressDoc } from "../customerCompleteness";


// تطبيع النص العربي للمقارنة التقريبية (همزات، تاء مربوطة، ألف مقصورة، تشكيل، مسافات)
export function normalizeArabic(s: string): string {
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

export function isSimilar(a: string, b: string): boolean {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// توليد متغيرات الهمزات لكلمة البحث حتى يجد فلتر like في ERPNext الأسماء
// المكتوبة بهمزات مختلفة (اسلام/إسلام/أسلام كلها نفس الاسم)
export function buildSearchVariants(word: string): string[] {
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
export async function erpSearchByField<T extends { name: string }>(
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
export async function findSimilarCustomers(name: string): Promise<Array<{ name: string; customer_name: string }>> {
  // بحث like بكل متغيرات الهمزات لأول كلمة، ثم فلترة تقريبية محلياً
  const all = await erpSearchByField<{ name: string; customer_name: string }>(
    "Customer", "customer_name", name, ["name", "customer_name"],
  );
  return all.filter(c => isSimilar(c.customer_name, name) || isSimilar(c.name, name));
}

// البحث عن أصناف مطابقة/مشابهة بالاسم أو الكود
export async function findSimilarItems(name: string): Promise<Array<{ name: string; item_name: string; standard_rate?: number }>> {
  const all = await erpSearchByField<{ name: string; item_name: string; standard_rate?: number }>(
    "Item", "item_name", name, ["name", "item_name", "standard_rate"],
  );
  return all.filter(i => isSimilar(i.item_name, name) || isSimilar(i.name, name));
}

// البحث عن موردين مطابقين/مشابهين بالاسم
export async function findSimilarSuppliers(name: string): Promise<Array<{ name: string; supplier_name: string }>> {
  const all = await erpSearchByField<{ name: string; supplier_name: string }>(
    "Supplier", "supplier_name", name, ["name", "supplier_name"],
  );
  return all.filter(s => isSimilar(s.supplier_name, name) || isSimilar(s.name, name));
}

// اعتماد مستند عام (docstatus = 1)
export async function submitDoc(doctype: string, docName: string): Promise<{ name: string; status?: string; grand_total?: number }> {
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
export async function getDefaultCompany(): Promise<string> {
  if (_defaultCompany) return _defaultCompany;
  const data = await erpGET(`/api/resource/Company?limit=1&fields=${encodeURIComponent(JSON.stringify(["name"]))}`) as { data: Array<{ name: string }> };
  _defaultCompany = data?.data?.[0]?.name ?? "";
  if (!_defaultCompany) throw new Error("لا توجد شركة معرّفة في النظام");
  return _defaultCompany;
}

// ترجمة أخطاء ERPNext الشائعة إلى رسائل عربية مفهومة
/**
 * يستخرج الرسالة البشرية من خطأ Frappe.
 *
 * الخطأ يصل غلافاً على غلاف: JSON فيه _server_messages وهو نصٌّ يحوي JSON آخر،
 * والرسالة داخله مهرَّبة بـ\uXXXX وفيها وسوم HTML لروابط النظام. تسليمه كما هو
 * — وقد حدث — يضع أمام محاسبٍ سطراً من الشيفرة بدل سبب مفهوم.
 */
export function frappeHumanMessage(raw: string): string {
  const candidates: string[] = [];

  // الجسم كائن JSON مسبوق أحياناً بـ"ERPNext DELETE error 417: " — نقتطع من أول قوس
  const brace = raw.indexOf("{");
  if (brace >= 0) {
    try {
      const body = JSON.parse(raw.slice(brace)) as { _server_messages?: string; exception?: string; message?: string };
      // _server_messages نصٌّ يحوي مصفوفة نصوص، كلٌّ منها JSON فيه message
      if (typeof body._server_messages === "string") {
        for (const entry of JSON.parse(body._server_messages) as string[]) {
          try {
            const m = (JSON.parse(entry) as { message?: string }).message;
            if (m) candidates.push(m);
          } catch { candidates.push(entry); }
        }
      }
      if (body.exception) candidates.push(body.exception.replace(/^[\w.]*(?:Error|Exception):\s*/, ""));
      if (body.message) candidates.push(body.message);
    } catch { /* ليس JSON كاملاً — نكمل بالمصادر النصّية */ }
  }

  const text = candidates.map(c => c.trim()).find(c => c.length > 0);
  if (!text) return "";

  return text
    .replace(/<a[^>]*>(.*?)<\/a>/gi, "$1")   // الرابط يُستبدل بنصّه لا يُحذف معه
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function translateErpError(raw: string): string {
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
  // إلغاء الملغى: ليس خطأ تحقق غامضاً بل حالة معروفة، والخطوة التالية الحذف
  if (/Cannot cancel|already cancelled|docstatus.*2/i.test(raw)) {
    return "المستند ملغى بالفعل — الإلغاء لا يُعاد، والخطوة التالية حذفه إن أردت إزالته";
  }
  if (/MandatoryError|is mandatory/i.test(raw)) return "حقل إلزامي ناقص: " + raw.slice(0, 200);
  // يُفحص قبل الصلاحيات: نصّه يحوي "not permitted" فكان يُقرأ رفضَ صلاحية،
  // فيُقال لمن يملك System Manager إن صلاحياته ناقصة. الحقيقة أن Frappe يقيّد
  // الحقول القابلة للترشيح في استعلام REST، والحل تغيير الحقل لا الصلاحيات.
  if (/Field not permitted in query|DataError/i.test(raw)) {
    const f = frappeHumanMessage(raw);
    const field = raw.match(/Field not permitted in query:\s*([A-Za-z0-9_]+)/)?.[1];
    return field
      ? `لا يمكن الترشيح بالحقل "${field}" في هذا النوع — جرّب حقلاً آخر أو ابحث من الطرف المقابل. (ليست مشكلة صلاحيات)`
      : f ? `رفض النظام الاستعلام: ${f}` : "استعلام غير مقبول من ERPNext — راجع أسماء الحقول";
  }
  if (/PermissionError|not permitted/i.test(raw)) {
    const f = frappeHumanMessage(raw);
    return f ? `صلاحيات غير كافية في نظامك: ${f}` : "صلاحيات غير كافية لتنفيذ هذه العملية في نظامك";
  }
  // الارتباط يمنع الحذف، ورسالة Frappe تسمّي المستند المانع — وهو ما يحتاجه
  // المستخدم ليعرف ماذا يفعل، لا رمز الاستثناء
  if (/LinkExistsError/i.test(raw)) {
    const f = frappeHumanMessage(raw);
    return f
      ? `${f} — احذف المستند المرتبط أو ألغه أولاً ثم أعد المحاولة`
      : "لا يمكن الحذف لوجود مستند مرتبط — ابحث عن المرتبطات وألغها أولاً";
  }
  if (/DoesNotExistError|not found/i.test(raw)) {
    const f = frappeHumanMessage(raw);
    return f ? `غير موجود: ${f}` : "السجل المطلوب غير موجود في النظام";
  }
  if (/ValidationError/i.test(raw)) {
    const f = frappeHumanMessage(raw);
    return f ? `رفض النظام العملية: ${f}` : "رفض النظام العملية لعدم استيفاء شرط تحقق";
  }
  // آخر مهرب: نصٌّ بشري إن وُجد، وإلا وصفٌ مختصر — لا JSON خام مهما كان
  const human = frappeHumanMessage(raw);
  if (human) return human.slice(0, 300);
  return raw.startsWith("{") || raw.includes('"exc_type"')
    ? "رفض نظام ERP العملية بخطأ لم يُرفق له سبب مقروء"
    : raw.slice(0, 300);
}

// مستندات الإعدادات الفردية (Single DocTypes) في Frappe/ERPNext: ليس لها جدول سجلات،
// وتُقرأ وتُعدَّل باسم النوع نفسه. استعلامها كقائمة يفشل بـ ProgrammingError،
// لذا أي Single DocType جديد يستخدمه الوكيل يجب إضافته هنا.
export const SINGLE_DOCTYPES = new Set([
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
export type CompanyInfo = { name: string; costCenter: string | null };
export const companyCache = new Map<string, { info: CompanyInfo | null; expiry: number }>();
export const COMPANY_CACHE_TTL = 10 * 60 * 1000;

export async function resolveCompanyInfo(): Promise<CompanyInfo | null> {
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
export function isCostCenterMismatch(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /cost center|مركز التكلفة/i.test(raw) && /belong|ينتمي/i.test(raw);
}

/**
 * ينشئ مستند بيع/شراء، وإن رفض ERPNext مركز التكلفة (لأن الأصناف تحمل
 * item_defaults قديمة لشركة محذوفة) يعيد المحاولة مرة واحدة بمركز تكلفة الشركة
 * الصحيح بدل أن يفشل الطلب على العميل.
 */
export async function postDocWithCostCenterRetry(
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
export async function checkTaxIdForCompanyCountry(taxId: string): Promise<{ valid: true; normalized: string } | { valid: false; reason: string }> {
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
export type TaxSetupOk = { ok: true; template: string; taxRows: Array<Record<string, unknown>>; companyTaxId?: string | null };
export type TaxSetupGap = { ok: false; missing: string[]; message: string; company?: string; companyTaxId?: string | null; availableTaxAccounts?: string[] };

export async function inspectTaxSetup(): Promise<TaxSetupOk | TaxSetupGap> {
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
export async function fetchCustomerAddress(customerName: string, primary: string | null): Promise<AddressDoc> {
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
export async function fetchCustomerAddressName(customerName: string, primary: string | null): Promise<string | null> {
  if (primary) return primary;
  try {
    const filters = encodeURIComponent(JSON.stringify([["Dynamic Link", "link_name", "=", customerName]]));
    const list = await erpGET(`/api/resource/Address?filters=${filters}&fields=${encodeURIComponent(JSON.stringify(["name"]))}&limit_page_length=1`) as { data?: { name: string }[] };
    return list?.data?.[0]?.name ?? null;
  } catch { return null; }
}
