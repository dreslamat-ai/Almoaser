// ─── Webhook إشعار MyFatoorah (Webhook V2 — Payment Status) ───────────────────
// MyFatoorah ترسل هذا الإشعار خادم-لخادم فور تغيّر حالة أي دفعة، حتى لو أغلق
// العميل المتصفح قبل رجوعه لصفحة الكولباك — يضمن عدم ضياع أي تفعيل اشتراك/شحن.
// نتحقق من التوقيع (HMAC-SHA256) حسب توثيق MyFatoorah، ثم لا نثق بأي حقل عمل من
// الجسم مباشرة: نعيد الاستعلام عن حالة الفاتورة عبر GetPaymentStatus الموثّق
// بمفتاح API الخاص بنا قبل أي تفعيل فعلي.
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import { getPaymentStatus } from "./myfatoorah";
import { finalizePaymentByReference } from "./paymentFinalize";

interface MyFatoorahWebhookPayload {
  Data?: {
    Invoice?: { Id?: string; Status?: string; ExternalIdentifier?: string };
    Transaction?: { Status?: string; PaymentId?: string };
  };
}

function verifySignature(payload: MyFatoorahWebhookPayload, signatureHeader: string, secret: string): boolean {
  const inv = payload.Data?.Invoice;
  const txn = payload.Data?.Transaction;
  // ترتيب الحقول موثّق من MyFatoorah لنموذج Payment Status — لا يجوز تغييره
  const message = [
    `Invoice.Id=${inv?.Id ?? ""}`,
    `Invoice.Status=${inv?.Status ?? ""}`,
    `Transaction.Status=${txn?.Status ?? ""}`,
    `Transaction.PaymentId=${txn?.PaymentId ?? ""}`,
    `Invoice.ExternalIdentifier=${inv?.ExternalIdentifier ?? ""}`,
  ].join(",");
  const expected = crypto.createHmac("sha256", secret).update(message, "utf8").digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function registerMyFatoorahWebhook(app: Express): void {
  app.post("/api/webhooks/myfatoorah", async (req: Request, res: Response) => {
    try {
      const payload = req.body as MyFatoorahWebhookPayload;
      const secret = process.env.MYFATOORAH_WEBHOOK_SECRET?.trim();
      const signature = req.header("MyFatoorah-Signature");

      if (secret) {
        if (!signature || !verifySignature(payload, signature, secret)) {
          console.warn("[myfatoorahWebhook] rejected: invalid or missing signature");
          res.status(401).send("invalid signature");
          return;
        }
      } else {
        console.warn("[myfatoorahWebhook] MYFATOORAH_WEBHOOK_SECRET غير مضبوط — يُعالَج بدون تحقق من التوقيع");
      }

      const invoiceId = payload.Data?.Invoice?.Id;
      if (!invoiceId) {
        res.status(400).send("missing invoice id");
        return;
      }

      // لا نثق بحالة الفاتورة داخل جسم الطلب — نتحقق منها مباشرة من MyFatoorah
      const status = await getPaymentStatus(invoiceId, "InvoiceId");
      await finalizePaymentByReference(status);
      res.status(200).send("ok");
    } catch (e) {
      console.error("[myfatoorahWebhook] error:", e instanceof Error ? e.message : e);
      res.status(500).send("error");
    }
  });
}
