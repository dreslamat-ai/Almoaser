// ─── فواتير الخدمة ───────────────────────────────────────────────────────────
//
// سجلّ ما دفعه العميل لنا: اشتراك أو شحن نقاط أو تمديد. الجدول كان يُقرأ ولا
// يُكتب فيه، فصفحة «فواتير اشتراكك» فارغة لكل من دفع.
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { serviceInvoices } from "../drizzle/schema";

export type InvoicePurpose = "subscription" | "topup" | "extension" | undefined;

/**
 * رقم الفاتورة: تسلسل سنوي مقروء.
 *
 * يُشتقّ من عدد فواتير السنة لا من معرّف الصفّ: المعرّف يكشف كم عميلاً لدينا،
 * ورقمُ الفاتورة يُقرأ ويُقال في مكالمة.
 */
async function nextInvoiceNumber(): Promise<string> {
  const db = await getDb();
  const year = new Date().getFullYear();
  if (!db) return `INV-${year}-0001`;
  const rows = await db.select({ n: serviceInvoices.invoiceNumber }).from(serviceInvoices);
  const prefix = `INV-${year}-`;
  const nums = rows
    .map(r => r.n)
    .filter(n => typeof n === "string" && n.startsWith(prefix))
    .map(n => Number(n.slice(prefix.length)))
    .filter(n => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function describe(purpose: InvoicePurpose, planName: string | null, credits: number | null, billing: string | null): string {
  if (purpose === "topup") return `شحن رصيد — ${credits ?? 0} نقطة`;
  if (purpose === "extension") return "تمديد اشتراك";
  const period = billing === "yearly" ? "سنوي" : "شهري";
  return planName ? `اشتراك ${planName} — ${period}` : `اشتراك ${period}`;
}

export async function createServiceInvoice(input: {
  userId: number;
  amount: number;
  purpose: InvoicePurpose;
  planName?: string | null;
  credits?: number | null;
  billing?: string | null;
  paidAt?: Date;
  subscriptionId?: number | null;
}): Promise<{ invoiceNumber: string } | null> {
  const db = await getDb();
  if (!db) return null;

  const invoiceNumber = await nextInvoiceNumber();
  await db.insert(serviceInvoices).values({
    userId: input.userId,
    subscriptionId: input.subscriptionId ?? null,
    invoiceNumber,
    amount: input.amount.toFixed(2),
    currency: "SAR",
    //تُنشأ مدفوعةً لأنها لا تُنشأ إلا بعد تأكيد التحصيل
    status: "paid",
    paidAt: input.paidAt ?? new Date(),
    description: describe(input.purpose, input.planName ?? null, input.credits ?? null, input.billing ?? null),
  });

  return { invoiceNumber };
}

export async function listUserInvoices(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(serviceInvoices).where(eq(serviceInvoices.userId, userId)).orderBy(desc(serviceInvoices.createdAt));
}
