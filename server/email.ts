/**
 * إرسال البريد الإلكتروني — طبقة مستقلة عن المزوّد وبدون أي حزمة إضافية (fetch فقط).
 *
 * المزوّد يُختار من متغيرات البيئة:
 *   RESEND_API_KEY  → Resend   (مجاني حتى 3000 رسالة/شهر)
 *   BREVO_API_KEY   → Brevo    (مجاني 300 رسالة/يوم)
 * ولازم كذلك:
 *   EMAIL_FROM      → مثال: "المعاصر <no-reply@erpsys.cloud>"
 *   APP_BASE_URL    → مثال: https://erpsys.cloud  (لبناء روابط التأكيد)
 *
 * لو لم يُضبط أي مفتاح، isEmailConfigured() ترجع false وكل الإرسال يُتجاهل بهدوء
 * مع تسجيل تحذير — فلا يتعطل أي مسار في التطبيق قبل ضبط المزوّد.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** نص بديل لعملاء البريد التي لا تعرض HTML */
  text?: string;
};

function provider(): "resend" | "brevo" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  return null;
}

export function isEmailConfigured(): boolean {
  return provider() !== null && !!process.env.EMAIL_FROM;
}

export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://erpsys.cloud").replace(/\/+$/, "");
}

/** يفصل "الاسم <email>" إلى اسم وبريد */
function parseFrom(raw: string): { email: string; name?: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || undefined, email: m[2].trim() };
  return { email: raw.trim() };
}

/** يحوّل HTML إلى نص تقريبي حين لا يُمرَّر نص صريح */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * يرسل رسالة. لا يرمي استثناءً أبداً — يرجع نجاح/فشل، حتى لا يُفشل أي عملية
 * تجارية (تسجيل/دفع) بسبب مشكلة في البريد.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const p = provider();
  const from = process.env.EMAIL_FROM;
  if (!p || !from) {
    console.warn(`[email] skipped "${msg.subject}" → ${msg.to}: مزوّد البريد غير مضبوط (RESEND_API_KEY/BREVO_API_KEY + EMAIL_FROM)`);
    return { ok: false, skipped: true };
  }
  const text = msg.text ?? htmlToText(msg.html);

  try {
    if (p === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`[email] Resend failed (${res.status}) for "${msg.subject}" → ${msg.to}: ${body.slice(0, 300)}`);
        return { ok: false, error: `Resend ${res.status}` };
      }
      return { ok: true };
    }

    const f = parseFrom(from);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": process.env.BREVO_API_KEY as string },
      body: JSON.stringify({
        sender: { email: f.email, name: f.name },
        to: [{ email: msg.to }],
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Brevo failed (${res.status}) for "${msg.subject}" → ${msg.to}: ${body.slice(0, 300)}`);
      return { ok: false, error: `Brevo ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[email] send threw for "${msg.subject}" → ${msg.to}:`, e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ─── قالب موحّد (RTL، يعمل في Gmail/Outlook بأنماط سطرية) ─────────────────────
const NAVY = "#1a2744";
const GOLD = "#c9a227";

export function renderEmail(opts: {
  heading: string;
  intro?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): string {
  const { heading, intro, bodyHtml, ctaLabel, ctaUrl, footerNote } = opts;
  return `<!DOCTYPE html><html dir="rtl" lang="ar"><body style="margin:0;padding:0;background:#f4f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;">
    <tr><td style="background:${NAVY};padding:20px 24px;">
      <div style="color:#ffffff;font-size:18px;font-weight:bold;">المعاصر — Almoaser AI ERP</div>
    </td></tr>
    <tr><td style="padding:26px 24px 8px;">
      <h1 style="margin:0 0 10px;font-size:20px;color:${NAVY};">${heading}</h1>
      ${intro ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.9;color:#40506b;">${intro}</p>` : ""}
      ${bodyHtml ?? ""}
      ${ctaLabel && ctaUrl ? `<div style="margin:22px 0 6px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:9px;font-size:15px;font-weight:bold;">${ctaLabel}</a>
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:#8794ad;word-break:break-all;">أو انسخ هذا الرابط: ${ctaUrl}</p>` : ""}
    </td></tr>
    <tr><td style="padding:18px 24px 24px;border-top:1px solid #eef1f6;">
      ${footerNote ? `<p style="margin:0 0 8px;font-size:11.5px;color:#8794ad;line-height:1.8;">${footerNote}</p>` : ""}
      <p style="margin:0;font-size:11.5px;color:#8794ad;">
        فريق المعاصر · <a href="${appBaseUrl()}" style="color:${GOLD};text-decoration:none;">${appBaseUrl().replace(/^https?:\/\//, "")}</a>
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** جدول بسيط لعرض بنود/قيم (يُستخدم في فواتير الدفع والتجديد) */
export function renderRows(rows: Array<{ label: string; value: string; bold?: boolean }>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 4px;font-size:14px;">
    ${rows.map(r => `<tr>
      <td style="padding:9px 0;color:#5b6b88;border-bottom:1px solid #eef1f6;">${r.label}</td>
      <td style="padding:9px 0;text-align:left;color:${NAVY};border-bottom:1px solid #eef1f6;${r.bold ? "font-weight:bold;" : ""}">${r.value}</td>
    </tr>`).join("")}
  </table>`;
}
