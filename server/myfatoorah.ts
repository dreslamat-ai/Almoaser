// ─── تكامل MyFatoorah للدفع الإلكتروني ────────────────────────────────────────
// المرجع: https://docs.myfatoorah.com — v2 API
// SendPayment: ينشئ فاتورة دفع برابط يدعم كل وسائل الدفع (مدى، فيزا، Apple Pay...)
// GetPaymentStatus: التحقق من حالة الدفع بعد عودة العميل من بوابة الدفع

const BASE_URL = (process.env.MYFATOORAH_BASE_URL || "https://apitest.myfatoorah.com").replace(/\/+$/, "");
const API_KEY = process.env.MYFATOORAH_API_KEY || "";

export function isMyFatoorahConfigured(): boolean {
  return Boolean(API_KEY);
}

async function mfFetch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!API_KEY) throw new Error("بوابة الدفع غير مهيأة بعد — أضف مفتاح MyFatoorah أولاً");
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    IsSuccess?: boolean;
    Message?: string;
    ValidationErrors?: Array<{ Name: string; Error: string }>;
    Data?: unknown;
  };
  if (!res.ok || !data.IsSuccess) {
    const valErr = data.ValidationErrors?.map(v => `${v.Name}: ${v.Error}`).join("; ");
    throw new Error(valErr || data.Message || `MyFatoorah request failed (${res.status})`);
  }
  return data.Data as T;
}

export interface SendPaymentResult {
  InvoiceId: number;
  InvoiceURL: string;
}

/** ينشئ فاتورة دفع ويرجع رابط الدفع */
export async function createPaymentLink(params: {
  amount: number;
  customerName: string;
  customerEmail?: string;
  customerMobile?: string;
  reference: string; // معرفنا الداخلي (payments.id)
  description: string;
  callbackUrl: string;
  errorUrl: string;
}): Promise<SendPaymentResult> {
  return mfFetch<SendPaymentResult>("/v2/SendPayment", {
    NotificationOption: "LNK",
    InvoiceValue: params.amount,
    DisplayCurrencyIso: "SAR",
    CustomerName: params.customerName || "عميل",
    CustomerEmail: params.customerEmail || undefined,
    MobileCountryCode: "+966",
    CustomerMobile: params.customerMobile?.replace(/^\+?966/, "").replace(/^0/, "") || undefined,
    CustomerReference: params.reference,
    Language: "AR",
    CallBackUrl: params.callbackUrl,
    ErrorUrl: params.errorUrl,
    InvoiceItems: [{ ItemName: params.description, Quantity: 1, UnitPrice: params.amount }],
  });
}

export interface PaymentStatusResult {
  InvoiceId: number;
  InvoiceStatus: string; // Paid | Pending | Expired | Failed...
  CustomerReference?: string;
  InvoiceTransactions?: Array<{ TransactionStatus: string; PaymentGateway: string }>;
}

/** يتحقق من حالة الدفع بمعرف الفاتورة أو PaymentId العائد في الـ callback */
export async function getPaymentStatus(key: string, keyType: "InvoiceId" | "PaymentId"): Promise<PaymentStatusResult> {
  return mfFetch<PaymentStatusResult>("/v2/GetPaymentStatus", { Key: key, KeyType: keyType });
}
