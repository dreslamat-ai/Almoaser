// طبقة تجريد موحّدة لأنظمة ERP المختلفة (ERPNext, Odoo, ...).
// كل نظام يوفّر implementation لهذه الواجهة، والمحاسب الذكي (agent.ts) يتعامل
// معها فقط دون معرفة تفاصيل النظام الفعلي خلفها.

export type ErpProvider = "erpnext" | "odoo";

export type ErpConnectionConfig = {
  provider: ErpProvider;
  url: string;
  username: string;
  password: string;
  /** مطلوب لـ Odoo فقط (اسم قاعدة البيانات) */
  database?: string;
  source: "user" | "system";
};

export type ClarificationNeeded = {
  needsClarification: true;
  reason: string;
  candidates: string[];
  searched?: string;
};

export type ErpError = { error: string };

export function isClarification(x: unknown): x is ClarificationNeeded {
  return !!x && typeof x === "object" && (x as ClarificationNeeded).needsClarification === true;
}

export function isErpError(x: unknown): x is ErpError {
  return !!x && typeof x === "object" && typeof (x as ErpError).error === "string";
}

export type Customer = {
  id: string;
  name: string;
  type?: "Company" | "Individual";
  mobile?: string;
  email?: string;
  taxId?: string;
};

export type Supplier = {
  id: string;
  name: string;
  type?: "Company" | "Individual";
  mobile?: string;
  email?: string;
};

export type Item = {
  id: string;
  name: string;
  code?: string;
  group?: string;
  standardRate?: number;
  uom?: string;
  isService?: boolean;
};

export type InvoiceLine = { itemId: string; qty: number; rate: number };

export type Invoice = {
  id: string;
  party: string; // اسم العميل أو المورد
  postingDate: string;
  dueDate?: string;
  grandTotal: number;
  netTotal?: number;
  totalTaxes?: number;
  outstandingAmount?: number;
  status?: string;
  currency?: string;
  docstatus: 0 | 1 | 2; // مسودة / معتمد / ملغى (توحيد لمفهوم Odoo state أيضاً)
};

export type Payment = {
  id: string;
  paymentType: "Receive" | "Pay";
  party: string;
  amount: number;
  postingDate: string;
  status?: string;
  modeOfPayment?: string;
};

export type Account = {
  id: string;
  name: string;
  accountType?: string;
  rootType?: "Asset" | "Liability" | "Equity" | "Income" | "Expense";
  isGroup: boolean;
};

export type JournalLine = { account: string; debit: number; credit: number };

export type JournalEntry = {
  id: string;
  postingDate: string;
  totalDebit: number;
  totalCredit: number;
  remark?: string;
  docstatus: 0 | 1 | 2;
};

export type SalesReport = {
  period: string;
  fromDate: string;
  toDate: string;
  totalInvoices: number;
  totalRevenue: number;
  paidRevenue: number;
  unpaidRevenue: number;
};

/**
 * الواجهة الموحّدة لكل عمليات ERP التي يحتاجها المحاسب الذكي.
 * كل دالة تُنفَّذ فعلياً على النظام الخلفي (ERPNext أو Odoo) وتُرجع نفس الشكل الموحَّد.
 */
export interface ErpAdapter {
  readonly provider: ErpProvider;

  testConnection(): Promise<{ ok: boolean; error?: string; companyName?: string }>;

  // العملاء
  listCustomers(opts: { limit?: number; search?: string }): Promise<Customer[]>;
  findSimilarCustomers(name: string): Promise<Customer[]>;
  createCustomer(input: { name: string; type?: "Company" | "Individual"; mobile?: string; email?: string; taxId?: string }): Promise<Customer>;

  // الموردون
  listSuppliers(opts: { limit?: number; search?: string }): Promise<Supplier[]>;
  findSimilarSuppliers(name: string): Promise<Supplier[]>;
  createSupplier(input: { name: string; type?: "Company" | "Individual"; mobile?: string; email?: string }): Promise<Supplier>;

  // الأصناف
  listItems(opts: { limit?: number; search?: string }): Promise<Item[]>;
  findSimilarItems(name: string): Promise<Item[]>;
  createItem(input: { name: string; code?: string; standardRate?: number; isService?: boolean; group?: string }): Promise<Item>;

  // فواتير المبيعات
  listInvoices(opts: { limit?: number; status?: string; customer?: string }): Promise<Invoice[]>;
  getInvoiceDetail(id: string): Promise<Invoice & { lines: InvoiceLine[] }>;
  createInvoice(input: { customerId: string; lines: InvoiceLine[]; dueDate?: string; applyVat: boolean }): Promise<Invoice>;
  getInvoicePdf(id: string): Promise<{ url: string }>;

  // فواتير المشتريات
  listPurchaseInvoices(opts: { limit?: number; status?: string; supplier?: string }): Promise<Invoice[]>;
  createPurchaseInvoice(input: { supplierId: string; lines: InvoiceLine[]; dueDate?: string }): Promise<Invoice>;

  // المدفوعات
  listPayments(opts: { limit?: number; paymentType?: "Receive" | "Pay"; party?: string }): Promise<Payment[]>;
  createPaymentEntry(input: {
    paymentType: "Receive" | "Pay";
    partyId: string;
    amount: number;
    referenceInvoiceId?: string;
    modeOfPayment?: string;
  }): Promise<Payment>;

  // الحسابات وقيود اليومية
  listAccounts(opts: { search?: string; rootType?: Account["rootType"] }): Promise<Account[]>;
  listJournalEntries(opts: { limit?: number }): Promise<JournalEntry[]>;
  createJournalEntry(input: { lines: JournalLine[]; remark?: string; postingDate?: string }): Promise<JournalEntry>;

  // عمليات عامة على المستندات (فاتورة/دفعة/قيد)
  submitDocument(kind: "SalesInvoice" | "PurchaseInvoice" | "Payment" | "Journal", id: string): Promise<{ id: string; status?: string }>;
  cancelDocument(kind: "SalesInvoice" | "PurchaseInvoice" | "Payment" | "Journal", id: string): Promise<{ id: string }>;
  deleteDocument(kind: "SalesInvoice" | "PurchaseInvoice" | "Payment" | "Journal" | "Customer" | "Supplier" | "Item", id: string): Promise<void>;
  updateDocument(
    kind: "SalesInvoice" | "PurchaseInvoice" | "Payment" | "Journal" | "Customer" | "Supplier" | "Item",
    id: string,
    fields: Record<string, unknown>
  ): Promise<{ id: string }>;

  // تقرير مبيعات
  getSalesReport(period: "this_month" | "last_month" | "this_year"): Promise<SalesReport>;

  /**
   * وصول مباشر لإعدادات/DocTypes النظام الخاصة بالمزوّد — قدرة متقدمة اختيارية
   * لا تُعمَّم شكلها (كل نظام له مفاهيم إعدادات مختلفة تماماً). النظم التي لا تدعمها
   * تُرجع undefined ويعرض الوكيل رسالة "غير مدعومة لهذا النظام".
   */
  getProviderSettings?(settingsType: string, name?: string): Promise<unknown>;
  updateProviderSettings?(settingsType: string, fields: Record<string, unknown>, name?: string): Promise<unknown>;
}
