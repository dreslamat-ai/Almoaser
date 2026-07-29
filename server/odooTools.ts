/**
 * تنفيذ أدوات الوكيل الذكي على Odoo (بدلاً من ERPNext) — نفس أسماء الأدوات
 * والمخرجات (__INVOICES__, __CUSTOMERS__...) بنفس أسماء الحقول المستخدمة في
 * الواجهة (name, customer, grand_total...) حتى تعمل الواجهة الحالية دون تعديل،
 * لكن التنفيذ الفعلي عبر Odoo JSON-RPC الخارجي (uid + password لكل استدعاء،
 * بدون جلسات cookie).
 *
 * تغطية أقل من ERPNext حالياً: لا يوجد مكافئ عام لـ get_settings/update_settings
 * (مفاهيم إعدادات Odoo مختلفة جذرياً ولكل شاشة نموذجها الخاص).
 */
import type { ErpConfig } from "./erpConnection";

const RPC_URL_SUFFIX = "/jsonrpc";

type OdooConfig = ErpConfig & { database: string };

async function odooCall(config: OdooConfig, service: string, method: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${config.url}${RPC_URL_SUFFIX}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args } }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string; data?: { message?: string } } };
  if (body.error) {
    throw new Error(body.error.data?.message ?? body.error.message ?? "Odoo RPC error");
  }
  return body.result;
}

const uidCache = new Map<string, number>();

async function getUid(config: OdooConfig): Promise<number> {
  const key = `${config.url}|${config.database}|${config.username}`;
  const cached = uidCache.get(key);
  if (cached) return cached;
  const uid = await odooCall(config, "common", "login", [config.database, config.username, config.password]) as number | false;
  if (!uid) throw new Error("فشل تسجيل الدخول إلى Odoo — تحقق من بيانات الاتصال (قاعدة البيانات/البريد/كلمة المرور)");
  uidCache.set(key, uid);
  return uid;
}

async function execute<T = unknown>(
  config: OdooConfig,
  model: string,
  method: string,
  args: unknown[],
  kwargs?: Record<string, unknown>
): Promise<T> {
  const uid = await getUid(config);
  return odooCall(config, "object", "execute_kw", [config.database, uid, config.password, model, method, args, kwargs ?? {}]) as Promise<T>;
}

export async function testOdooConnection(config: OdooConfig): Promise<{ ok: boolean; loggedInAs?: string; error?: string }> {
  try {
    const uid = await odooCall(config, "common", "login", [config.database, config.username, config.password]) as number | false;
    if (!uid) return { ok: false, error: "بيانات الاعتماد غير صحيحة" };
    return { ok: true, loggedInAs: config.username };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذّر الاتصال بخادم Odoo" };
  }
}

// ─── تحويل حالة move إلى docstatus بمفهوم ERPNext (0 مسودة / 1 معتمد / 2 ملغى) ───
function moveStateToDocstatus(state: string): number {
  if (state === "posted") return 1;
  if (state === "cancel") return 2;
  return 0;
}

type Partner = { id: number; name: string; email?: string | false; phone?: string | false; mobile?: string | false; company_type?: string };
type Product = { id: number; name: string; default_code?: string | false; list_price?: number; type?: string };
type Move = { id: number; name: string; partner_id?: [number, string] | false; invoice_date_due?: string | false; invoice_date?: string | false; amount_total?: number; amount_residual?: number; state?: string; payment_state?: string; currency_id?: [number, string] };

function partnerToCustomer(p: Partner) {
  return { name: String(p.id), customer_name: p.name, customer_type: p.company_type === "company" ? "Company" : "Individual", mobile_no: p.mobile || p.phone || undefined, email_id: p.email || undefined };
}
function partnerToSupplier(p: Partner) {
  return { name: String(p.id), supplier_name: p.name, supplier_type: p.company_type === "company" ? "Company" : "Individual", mobile_no: p.mobile || p.phone || undefined, email_id: p.email || undefined };
}
function productToItem(p: Product) {
  return { name: String(p.id), item_name: p.name, item_group: undefined, standard_rate: p.list_price, stock_uom: "Unit" };
}
function moveToInvoice(m: Move) {
  return {
    name: m.name,
    customer: m.partner_id ? m.partner_id[1] : undefined,
    supplier: m.partner_id ? m.partner_id[1] : undefined,
    posting_date: m.invoice_date || undefined,
    due_date: m.invoice_date_due || undefined,
    grand_total: m.amount_total ?? 0,
    outstanding_amount: m.amount_residual ?? 0,
    status: m.payment_state === "paid" ? "Paid" : m.state === "cancel" ? "Cancelled" : m.state === "draft" ? "Draft" : "Unpaid",
    currency: m.currency_id ? m.currency_id[1] : undefined,
  };
}

const CUSTOMER_FIELDS = ["id", "name", "email", "phone", "mobile", "company_type"];
const PRODUCT_FIELDS = ["id", "name", "default_code", "list_price", "type"];
const MOVE_FIELDS = ["id", "name", "partner_id", "invoice_date", "invoice_date_due", "amount_total", "amount_residual", "state", "payment_state", "currency_id"];

/**
 * بعض نسخ/تخصيصات Odoo تحذف حقولاً قياسية من res.partner (مثل mobile) — بدل ما
 * يفشل طلب العملاء/الموردين بالكامل، نعيد المحاولة تدريجياً بحقول أقل عند خطأ
 * "Invalid field" بدل تعطيل الميزة على تلك النسخة كلياً.
 */
async function searchReadPartnersResilient(
  config: OdooConfig, domain: unknown[], limit: number
): Promise<Partner[]> {
  const fieldSets = [CUSTOMER_FIELDS, ["id", "name", "email", "phone", "company_type"], ["id", "name", "email", "company_type"]];
  let lastError: unknown;
  for (const fields of fieldSets) {
    try {
      return await execute<Partner[]>(config, "res.partner", "search_read", [domain, fields], { limit });
    } catch (e) {
      lastError = e;
      if (!(e instanceof Error) || !/Invalid field/i.test(e.message)) throw e;
    }
  }
  throw lastError;
}

async function findSimilarPartners(config: OdooConfig, name: string, rankField: "customer_rank" | "supplier_rank") {
  return searchReadPartnersResilient(config, [[rankField, ">", 0], ["name", "ilike", name]], 20);
}

/** نفس منطق التساهل مع الحقول عند الإنشاء — لو "mobile" غير معرَّف على res.partner نحوّله لـ phone بدل فشل الإنشاء بالكامل */
async function createPartnerResilient(config: OdooConfig, values: Record<string, unknown>): Promise<number> {
  try {
    return await execute<number>(config, "res.partner", "create", [values]);
  } catch (e) {
    if (e instanceof Error && /Invalid field 'mobile'/i.test(e.message) && "mobile" in values) {
      const { mobile, ...rest } = values;
      return await execute<number>(config, "res.partner", "create", [rest.phone ? rest : { ...rest, phone: mobile }]);
    }
    throw e;
  }
}

async function resolvePartnerId(config: OdooConfig, nameOrId: string, rankField: "customer_rank" | "supplier_rank"): Promise<{ id: number } | { candidates: Partner[] } | { notFound: true }> {
  if (/^\d+$/.test(nameOrId)) return { id: Number(nameOrId) };
  const matches = await findSimilarPartners(config, nameOrId, rankField);
  const exact = matches.find(m => m.name.trim().toLowerCase() === nameOrId.trim().toLowerCase());
  if (exact) return { id: exact.id };
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length > 1) return { candidates: matches };
  return { notFound: true };
}

async function resolveProductId(config: OdooConfig, codeOrName: string): Promise<{ id: number } | { candidates: Product[] } | { notFound: true }> {
  if (/^\d+$/.test(codeOrName)) return { id: Number(codeOrName) };
  const matches = await execute<Product[]>(config, "product.product", "search_read", [
    ["|", ["name", "ilike", codeOrName], ["default_code", "ilike", codeOrName]], PRODUCT_FIELDS,
  ], { limit: 20 });
  const exact = matches.find(m => m.name.trim().toLowerCase() === codeOrName.trim().toLowerCase() || m.default_code === codeOrName);
  if (exact) return { id: exact.id };
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length > 1) return { candidates: matches };
  return { notFound: true };
}

const DOCTYPE_TO_MOVE_TYPE: Record<string, string> = {
  "Sales Invoice": "out_invoice",
  "Purchase Invoice": "in_invoice",
  "Journal Entry": "entry",
};

export async function executeOdooTool(
  name: string,
  args: Record<string, unknown>,
  config: OdooConfig
): Promise<{ result: unknown; display: string }> {
  switch (name) {
    case "get_customers": {
      const limit = (args.limit as number) ?? 20;
      const domain: unknown[] = [["customer_rank", ">", 0]];
      if (args.search) domain.push(["name", "ilike", args.search]);
      const rows = await searchReadPartnersResilient(config, domain, limit);
      const out = rows.map(partnerToCustomer);
      return { result: out, display: `__CUSTOMERS__${JSON.stringify(out)}` };
    }
    case "create_customer": {
      const existing = await findSimilarPartners(config, args.customer_name as string, "customer_rank");
      if (existing.length > 0) {
        return { result: { duplicate_prevented: true, message: `يوجد ${existing.length} عميل مشابه بالفعل`, candidates: existing.map(partnerToCustomer) }, display: "" };
      }
      const id = await createPartnerResilient(config, {
        name: args.customer_name,
        customer_rank: 1,
        company_type: (args.customer_type as string) === "Individual" ? "person" : "company",
        ...(args.mobile_no ? { mobile: args.mobile_no } : {}),
        ...(args.email_id ? { email: args.email_id } : {}),
      });
      const created = { name: String(id), customer_name: args.customer_name, customer_type: args.customer_type ?? "Company" };
      return { result: created, display: `__CUSTOMER_CREATED__${JSON.stringify(created)}` };
    }
    case "get_suppliers": {
      const limit = (args.limit as number) ?? 20;
      const domain: unknown[] = [["supplier_rank", ">", 0]];
      if (args.search) domain.push(["name", "ilike", args.search]);
      const rows = await searchReadPartnersResilient(config, domain, limit);
      const out = rows.map(partnerToSupplier);
      return { result: out, display: `__SUPPLIERS__${JSON.stringify(out)}` };
    }
    case "create_supplier": {
      const existing = await findSimilarPartners(config, args.supplier_name as string, "supplier_rank");
      if (existing.length > 0) {
        return { result: { duplicate_prevented: true, message: `يوجد ${existing.length} مورد مشابه بالفعل`, candidates: existing.map(partnerToSupplier) }, display: "" };
      }
      const id = await createPartnerResilient(config, {
        name: args.supplier_name,
        supplier_rank: 1,
        company_type: (args.supplier_type as string) === "Individual" ? "person" : "company",
        ...(args.mobile_no ? { mobile: args.mobile_no } : {}),
        ...(args.email_id ? { email: args.email_id } : {}),
      });
      const created = { name: String(id), supplier_name: args.supplier_name, supplier_type: args.supplier_type ?? "Company" };
      return { result: created, display: `__SUPPLIER_CREATED__${JSON.stringify(created)}` };
    }
    case "get_items": {
      const limit = (args.limit as number) ?? 20;
      const domain: unknown[] = args.search ? ["|", ["name", "ilike", args.search], ["default_code", "ilike", args.search]] : [];
      const rows = await execute<Product[]>(config, "product.product", "search_read", [domain, PRODUCT_FIELDS], { limit });
      const out = rows.map(productToItem);
      return { result: out, display: `__ITEMS__${JSON.stringify(out)}` };
    }
    case "create_item": {
      const id = await execute<number>(config, "product.product", "create", [{
        name: args.item_name,
        ...(args.item_code ? { default_code: args.item_code } : {}),
        type: (args.is_service as boolean) === false ? "consu" : "service",
        ...(args.standard_rate ? { list_price: args.standard_rate } : {}),
      }]);
      const created = { name: String(id), item_name: args.item_name, standard_rate: args.standard_rate, is_stock_item: (args.is_service as boolean) === false ? 1 : 0 };
      return { result: created, display: `__ITEM_CREATED__${JSON.stringify(created)}` };
    }
    case "get_invoices": {
      const limit = (args.limit as number) ?? 10;
      const domain: unknown[] = [["move_type", "=", "out_invoice"]];
      if (args.status === "Paid") domain.push(["payment_state", "=", "paid"]);
      if (args.customer) domain.push(["partner_id.name", "ilike", args.customer]);
      const rows = await execute<Move[]>(config, "account.move", "search_read", [domain, MOVE_FIELDS], { limit, order: "invoice_date desc" });
      const out = rows.map(moveToInvoice);
      return { result: out, display: `__INVOICES__${JSON.stringify(out)}` };
    }
    case "get_invoice_detail": {
      const idResult = await resolvePartnerLikeMoveId(config, args.invoice_name as string, "out_invoice");
      if ("error" in idResult) return { result: { error: idResult.error }, display: "" };
      const rows = await execute<Move[]>(config, "account.move", "read", [[idResult.id]], { fields: MOVE_FIELDS });
      const lines = await execute<Array<{ product_id?: [number, string]; quantity: number; price_unit: number }>>(
        config, "account.move.line", "search_read",
        [[["move_id", "=", idResult.id], ["display_type", "=", false], ["exclude_from_invoice_tab", "=", false]], ["product_id", "quantity", "price_unit"]]
      );
      const detail = { ...moveToInvoice(rows[0]), items: lines.map(l => ({ item_code: l.product_id?.[1], qty: l.quantity, rate: l.price_unit })) };
      return { result: detail, display: `__INVOICE_DETAIL__${JSON.stringify(detail)}` };
    }
    case "create_invoice": {
      const custResolved = await resolvePartnerId(config, args.customer as string, "customer_rank");
      if ("notFound" in custResolved) return { result: { error: `العميل "${args.customer}" غير موجود` }, display: "" };
      if ("candidates" in custResolved) return { result: { needs_clarification: true, reason: "found_multiple_customers", candidates: custResolved.candidates.map(c => c.name) }, display: "" };

      // حماية: الفاتورة الضريبية تتطلب رقماً ضريبياً (vat) مسجلاً للعميل من نوع شركة —
      // نتجاهل فشل الفحص نفسه (لا نمنع الفاتورة لو الحقل مش متاح على هذه النسخة من Odoo)
      try {
        const partnerRows = await execute<Array<{ company_type?: string; vat?: string; name?: string }>>(
          config, "res.partner", "read", [[custResolved.id]], { fields: ["company_type", "vat", "name"] }
        );
        const partner = partnerRows[0];
        if (partner && partner.company_type !== "person" && !partner.vat) {
          return {
            result: { needs_clarification: true, reason: "missing_tax_id", customer: String(custResolved.id), customer_name: partner.name ?? args.customer },
            display: "",
          };
        }
      } catch { /* تجاهل - فحص اختياري */ }

      const rawItems = args.items as Array<{ item_code: string; qty: number; rate: number }>;
      const lineVals: Array<[number, number, Record<string, unknown>]> = [];
      for (const it of rawItems) {
        const prodResolved = await resolveProductId(config, it.item_code);
        if ("notFound" in prodResolved) return { result: { error: `الصنف "${it.item_code}" غير موجود` }, display: "" };
        if ("candidates" in prodResolved) return { result: { needs_clarification: true, reason: "found_multiple_items", searched: it.item_code, candidates: prodResolved.candidates.map(p => p.name) }, display: "" };
        lineVals.push([0, 0, { product_id: prodResolved.id, quantity: it.qty, price_unit: it.rate }]);
      }
      const id = await execute<number>(config, "account.move", "create", [{
        move_type: "out_invoice",
        partner_id: custResolved.id,
        ...(args.due_date ? { invoice_date_due: args.due_date } : {}),
        invoice_line_ids: lineVals,
      }]);
      const rows = await execute<Move[]>(config, "account.move", "read", [[id]], { fields: MOVE_FIELDS });
      const inv = moveToInvoice(rows[0]);
      return { result: inv, display: `__INVOICE_CREATED__${JSON.stringify({ name: inv.name, customer: inv.customer, items: rawItems, grand_total: inv.grand_total })}` };
    }
    case "submit_invoice": {
      const idResult = await resolvePartnerLikeMoveId(config, args.invoice_name as string, "out_invoice");
      if ("error" in idResult) return { result: { error: idResult.error }, display: "" };
      await execute(config, "account.move", "action_post", [[idResult.id]]);
      const rows = await execute<Move[]>(config, "account.move", "read", [[idResult.id]], { fields: MOVE_FIELDS });
      const inv = moveToInvoice(rows[0]);
      return { result: inv, display: `__INVOICE_SUBMITTED__${JSON.stringify({ name: inv.name, status: inv.status, grand_total: inv.grand_total })}` };
    }
    case "get_purchase_invoices": {
      const limit = (args.limit as number) ?? 10;
      const domain: unknown[] = [["move_type", "=", "in_invoice"]];
      if (args.supplier) domain.push(["partner_id.name", "ilike", args.supplier]);
      const rows = await execute<Move[]>(config, "account.move", "search_read", [domain, MOVE_FIELDS], { limit, order: "invoice_date desc" });
      return { result: rows.map(moveToInvoice), display: `__PURCHASE_INVOICES__${JSON.stringify(rows.map(moveToInvoice))}` };
    }
    case "create_purchase_invoice": {
      const supResolved = await resolvePartnerId(config, args.supplier as string, "supplier_rank");
      if ("notFound" in supResolved) return { result: { error: `المورد "${args.supplier}" غير موجود` }, display: "" };
      if ("candidates" in supResolved) return { result: { needs_clarification: true, reason: "found_multiple_suppliers", candidates: supResolved.candidates.map(c => c.name) }, display: "" };
      const rawItems = args.items as Array<{ item_code: string; qty: number; rate: number }>;
      const lineVals: Array<[number, number, Record<string, unknown>]> = [];
      for (const it of rawItems) {
        const prodResolved = await resolveProductId(config, it.item_code);
        if ("notFound" in prodResolved) return { result: { error: `الصنف "${it.item_code}" غير موجود` }, display: "" };
        if ("candidates" in prodResolved) return { result: { needs_clarification: true, reason: "found_multiple_items", searched: it.item_code, candidates: prodResolved.candidates.map(p => p.name) }, display: "" };
        lineVals.push([0, 0, { product_id: prodResolved.id, quantity: it.qty, price_unit: it.rate }]);
      }
      const id = await execute<number>(config, "account.move", "create", [{
        move_type: "in_invoice",
        partner_id: supResolved.id,
        ...(args.due_date ? { invoice_date_due: args.due_date } : {}),
        invoice_line_ids: lineVals,
      }]);
      const rows = await execute<Move[]>(config, "account.move", "read", [[id]], { fields: MOVE_FIELDS });
      const inv = moveToInvoice(rows[0]);
      return { result: inv, display: `__PURCHASE_INVOICE_CREATED__${JSON.stringify({ name: inv.name, supplier: inv.supplier, items: rawItems, grand_total: inv.grand_total })}` };
    }
    case "get_payments": {
      const limit = (args.limit as number) ?? 10;
      const domain: unknown[] = [];
      if (args.payment_type) domain.push(["payment_type", "=", args.payment_type === "Receive" ? "inbound" : "outbound"]);
      if (args.party) domain.push(["partner_id.name", "ilike", args.party]);
      const rows = await execute<Array<{ id: number; name: string; partner_id?: [number, string]; amount: number; date: string; state: string }>>(
        config, "account.payment", "search_read", [domain, ["id", "name", "partner_id", "amount", "date", "state"]], { limit, order: "date desc" }
      );
      const out = rows.map(p => ({
        name: p.name, payment_type: undefined, party: p.partner_id?.[1], paid_amount: p.amount, posting_date: p.date, status: p.state,
      }));
      return { result: out, display: `__PAYMENTS__${JSON.stringify(out)}` };
    }
    case "create_payment_entry": {
      const paymentType = args.payment_type as string;
      const rankField = paymentType === "Receive" ? "customer_rank" : "supplier_rank";
      const partyResolved = await resolvePartnerId(config, args.party as string, rankField);
      if ("notFound" in partyResolved) return { result: { error: `الطرف "${args.party}" غير موجود` }, display: "" };
      if ("candidates" in partyResolved) return { result: { needs_clarification: true, reason: "found_multiple_parties", candidates: partyResolved.candidates.map(c => c.name) }, display: "" };
      const id = await execute<number>(config, "account.payment", "create", [{
        payment_type: paymentType === "Receive" ? "inbound" : "outbound",
        partner_type: paymentType === "Receive" ? "customer" : "supplier",
        partner_id: partyResolved.id,
        amount: args.amount,
      }]);
      const rows = await execute<Array<{ id: number; name: string; partner_id?: [number, string]; amount: number }>>(
        config, "account.payment", "read", [[id]], { fields: ["name", "partner_id", "amount"] }
      );
      const created = { name: rows[0].name, payment_type: paymentType, party: rows[0].partner_id?.[1], paid_amount: rows[0].amount };
      return { result: created, display: `__PAYMENT_CREATED__${JSON.stringify(created)}` };
    }
    case "get_accounts": {
      const domain: unknown[] = [];
      if (args.search) domain.push(["name", "ilike", args.search]);
      const rows = await execute<Array<{ id: number; name: string; code: string; account_type: string }>>(
        config, "account.account", "search_read", [domain, ["id", "name", "code", "account_type"]], { limit: 50 }
      );
      const rootTypeMap: Record<string, string> = {
        income: "Income", income_other: "Income", expense: "Expense", expense_direct_cost: "Expense",
        asset_receivable: "Asset", asset_cash: "Asset", asset_current: "Asset", asset_fixed: "Asset",
        liability_payable: "Liability", liability_current: "Liability", equity: "Equity",
      };
      const out = rows.map(a => ({ name: `${a.code} ${a.name}`, account_name: a.name, account_type: a.account_type, root_type: rootTypeMap[a.account_type] ?? a.account_type, is_group: false }));
      return { result: out, display: `__ACCOUNTS__${JSON.stringify(out)}` };
    }
    case "get_journal_entries": {
      const limit = (args.limit as number) ?? 10;
      const rows = await execute<Move[]>(config, "account.move", "search_read", [[["move_type", "=", "entry"]], MOVE_FIELDS], { limit, order: "invoice_date desc" });
      const out = rows.map(m => ({ name: m.name, posting_date: m.invoice_date, total_debit: m.amount_total, total_credit: m.amount_total, docstatus: moveStateToDocstatus(m.state ?? "draft") }));
      return { result: out, display: `__JOURNAL_ENTRIES__${JSON.stringify(out)}` };
    }
    case "create_journal_entry": {
      const entries = args.entries as Array<{ account: string; debit: number; credit: number }>;
      const totalDebit = entries.reduce((s, e) => s + (e.debit ?? 0), 0);
      const totalCredit = entries.reduce((s, e) => s + (e.credit ?? 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.001) {
        return { result: { error: `القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}` }, display: "" };
      }
      const lineVals: Array<[number, number, Record<string, unknown>]> = [];
      for (const e of entries) {
        const accRows = await execute<Array<{ id: number; name: string }>>(
          config, "account.account", "search_read", [[["name", "ilike", e.account]], ["id", "name"]], { limit: 5 }
        );
        if (accRows.length === 0) return { result: { error: `الحساب "${e.account}" غير موجود` }, display: "" };
        if (accRows.length > 1) {
          const exact = accRows.find(a => a.name.trim().toLowerCase() === e.account.trim().toLowerCase());
          if (!exact) return { result: { needs_clarification: true, reason: "found_multiple_accounts", searched: e.account, candidates: accRows.map(a => a.name) }, display: "" };
          lineVals.push([0, 0, { account_id: exact.id, debit: e.debit ?? 0, credit: e.credit ?? 0 }]);
        } else {
          lineVals.push([0, 0, { account_id: accRows[0].id, debit: e.debit ?? 0, credit: e.credit ?? 0 }]);
        }
      }
      const id = await execute<number>(config, "account.move", "create", [{
        move_type: "entry",
        ...(args.posting_date ? { date: args.posting_date } : {}),
        ...(args.remark ? { ref: args.remark } : {}),
        line_ids: lineVals,
      }]);
      const rows = await execute<Move[]>(config, "account.move", "read", [[id]], { fields: MOVE_FIELDS });
      return { result: rows[0], display: `__JOURNAL_CREATED__${JSON.stringify({ name: rows[0].name, total_debit: totalDebit, entries: entries.length })}` };
    }
    case "submit_document": {
      const model = DOCTYPE_TO_MOVE_TYPE[args.doctype as string] ? "account.move" : args.doctype === "Payment Entry" ? "account.payment" : null;
      if (!model) return { result: { error: `نوع المستند "${args.doctype}" غير مدعوم في Odoo` }, display: "" };
      const id = await resolveMoveOrPaymentId(config, model, args.document_name as string);
      if (id == null) return { result: { error: "المستند غير موجود" }, display: "" };
      const method = model === "account.move" ? "action_post" : "action_post";
      await execute(config, model, method, [[id]]);
      return { result: { name: args.document_name, status: "Submitted" }, display: `__DOC_SUBMITTED__${JSON.stringify({ doctype: args.doctype, name: args.document_name })}` };
    }
    case "cancel_document": {
      const model = args.doctype === "Payment Entry" ? "account.payment" : "account.move";
      const id = await resolveMoveOrPaymentId(config, model, args.document_name as string);
      if (id == null) return { result: { error: "المستند غير موجود" }, display: "" };
      await execute(config, model, "button_cancel", [[id]]);
      return { result: { name: args.document_name }, display: `__DOC_CANCELLED__${JSON.stringify({ doctype: args.doctype, name: args.document_name })}` };
    }
    case "delete_document": {
      const modelMap: Record<string, string> = {
        "Sales Invoice": "account.move", "Purchase Invoice": "account.move", "Journal Entry": "account.move",
        "Payment Entry": "account.payment", Customer: "res.partner", Supplier: "res.partner", Item: "product.product",
      };
      const model = modelMap[args.doctype as string];
      if (!model) return { result: { error: `نوع المستند "${args.doctype}" غير مدعوم` }, display: "" };
      const id = ["Customer", "Supplier", "Item"].includes(args.doctype as string)
        ? Number(args.document_name)
        : await resolveMoveOrPaymentId(config, model, args.document_name as string);
      if (id == null) return { result: { error: "غير موجود" }, display: "" };
      try {
        await execute(config, model, "unlink", [[id]]);
      } catch {
        // المستندات المعتمدة تحتاج إلغاء أولاً في Odoo
        await execute(config, model, "button_cancel", [[id]]).catch(() => {});
        await execute(config, model, "unlink", [[id]]);
      }
      return { result: { deleted: true, name: args.document_name }, display: `__DOC_DELETED__${JSON.stringify({ doctype: args.doctype, name: args.document_name })}` };
    }
    case "update_document": {
      const modelMap: Record<string, string> = {
        "Sales Invoice": "account.move", "Purchase Invoice": "account.move", "Journal Entry": "account.move",
        "Payment Entry": "account.payment", Customer: "res.partner", Supplier: "res.partner", Item: "product.product",
      };
      const model = modelMap[args.doctype as string];
      if (!model) return { result: { error: `نوع المستند "${args.doctype}" غير مدعوم` }, display: "" };
      const fields = args.fields as Record<string, unknown>;
      const id = ["Customer", "Supplier", "Item"].includes(args.doctype as string)
        ? Number(args.document_name)
        : await resolveMoveOrPaymentId(config, model, args.document_name as string);
      if (id == null) return { result: { error: "غير موجود" }, display: "" };
      await execute(config, model, "write", [[id], fields]);
      return { result: { id }, display: `__DOC_UPDATED__${JSON.stringify({ doctype: args.doctype, name: args.document_name, fields: Object.keys(fields) })}` };
    }
    case "get_sales_report": {
      const now = new Date();
      let fromDate: string, toDate: string;
      if (args.period === "last_month") {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        fromDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
        toDate = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}-${new Date(now.getFullYear(), now.getMonth(), 0).getDate()}`;
      } else if (args.period === "this_year") {
        fromDate = `${now.getFullYear()}-01-01`; toDate = `${now.getFullYear()}-12-31`;
      } else {
        fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        toDate = now.toISOString().split("T")[0];
      }
      const rows = await execute<Move[]>(config, "account.move", "search_read", [
        [["move_type", "=", "out_invoice"], ["state", "=", "posted"], ["invoice_date", ">=", fromDate], ["invoice_date", "<=", toDate]],
        ["amount_total", "payment_state"],
      ], { limit: 500 });
      const total = rows.reduce((s, r) => s + (r.amount_total ?? 0), 0);
      const paid = rows.filter(r => (r as unknown as { payment_state?: string }).payment_state === "paid").reduce((s, r) => s + (r.amount_total ?? 0), 0);
      const report = { period: (args.period as string) ?? "this_month", fromDate, toDate, totalInvoices: rows.length, totalRevenue: total, paidRevenue: paid, unpaidRevenue: total - paid };
      return { result: report, display: `__REPORT__${JSON.stringify(report)}` };
    }
    case "get_settings":
    case "update_settings":
      return { result: { error: "إعدادات النظام غير مدعومة حالياً عند استخدام Odoo — هذه الميزة متاحة فقط مع ERPNext" }, display: "" };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * يولّد PDF أي مستند عبر محرك تقارير Odoo نفسه (QWeb) — نفس التقرير الذي يستخدمه
 * العميل من واجهة Odoo عند الضغط على "طباعة" على المستند (شعاره وتخطيطه المُعدّين
 * في "إعدادات المحاسبة > تخطيط المستندات")، وليس نموذجاً مُعاد بناؤه في تطبيقنا.
 */
export async function getOdooDocumentPdf(config: OdooConfig, doctype: string, nameOrId: string): Promise<{ pdfBase64: string; filename: string } | { error: string }> {
  try {
    let reportNames: string[];
    let id: number;

    if (doctype === "Sales Invoice" || doctype === "Purchase Invoice") {
      // نفس التقرير القياسي في Odoo لكل من الفاتورة وفاتورة المورد (يميّز التسمية داخلياً حسب move_type)
      // نجرّب اسمين لأن التسمية اختلفت بين إصدارات/تخصيصات Odoo
      reportNames = ["account.report_invoice_with_payments", "account.report_invoice"];
      const idResult = await resolvePartnerLikeMoveId(config, nameOrId, DOCTYPE_TO_MOVE_TYPE[doctype]);
      if ("error" in idResult) return idResult;
      id = idResult.id;
    } else if (doctype === "Payment Entry") {
      reportNames = ["account.report_payment_receipt_document"];
      const resolvedId = await resolveMoveOrPaymentId(config, "account.payment", nameOrId);
      if (resolvedId == null) return { error: `الدفعة "${nameOrId}" غير موجودة` };
      id = resolvedId;
    } else {
      // القيود اليومية (Journal Entry) ليس لها نموذج طباعة قياسي في Odoo
      return { error: `طباعة مستند "${doctype}" غير مدعومة حالياً على Odoo` };
    }

    let lastError: unknown;
    for (const reportName of reportNames) {
      try {
        const result = await execute<[string, string]>(config, "ir.actions.report", "render_qweb_pdf", [reportName, [id]]);
        return { pdfBase64: result[0], filename: `${nameOrId}.pdf` };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر توليد PDF المستند من Odoo" };
  }
}

async function resolvePartnerLikeMoveId(config: OdooConfig, invoiceNameOrId: string, moveType: string): Promise<{ id: number } | { error: string }> {
  if (/^\d+$/.test(invoiceNameOrId)) return { id: Number(invoiceNameOrId) };
  const rows = await execute<Array<{ id: number }>>(config, "account.move", "search_read", [
    [["move_type", "=", moveType], ["name", "=", invoiceNameOrId]], ["id"],
  ], { limit: 1 });
  if (rows.length === 0) return { error: `الفاتورة "${invoiceNameOrId}" غير موجودة` };
  return { id: rows[0].id };
}

async function resolveMoveOrPaymentId(config: OdooConfig, model: string, nameOrId: string): Promise<number | null> {
  if (/^\d+$/.test(nameOrId)) return Number(nameOrId);
  const rows = await execute<Array<{ id: number }>>(config, model, "search_read", [[["name", "=", nameOrId]], ["id"]], { limit: 1 });
  return rows[0]?.id ?? null;
}
