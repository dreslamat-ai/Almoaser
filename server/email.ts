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

// ─── هوية القالب ──────────────────────────────────────────────────────────────
// كل الأنماط سطرية (inline) لأن Gmail يحذف <style>، والتخطيط بجداول لأن Outlook
// (محرك Word) لا يدعم flex/grid. الخطوط تسلسل احتياطي عربي آمن بلا خطوط خارجية.
const NAVY = "#16233d";
const NAVY_SOFT = "#25365a";
const GOLD = "#c9a227";
const INK = "#1f2a3d";
const MUTED = "#6b7a94";
const HAIRLINE = "#e8ecf3";
const CANVAS = "#eef1f6";
const FONT = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";

function logoUrl(): string {
  return `${appBaseUrl()}/icons/icon-192x192.png`;
}

/** يمنع Gmail من قصّ الرسالة الطويلة ويخفي نص المعاينة */
function preheader(text: string): string {
  return `<div style="display:none;font-size:1px;color:${CANVAS};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${text}</div>`;
}

export type EmailTone = "default" | "success" | "warning";

const TONE: Record<EmailTone, { bar: string; chipBg: string; chipInk: string }> = {
  default: { bar: NAVY, chipBg: "#eef2fa", chipInk: NAVY },
  success: { bar: "#1c7a53", chipBg: "#e7f6ee", chipInk: "#14603f" },
  warning: { bar: "#a86a12", chipBg: "#fdf3e2", chipInk: "#8a5406" },
};

export function renderEmail(opts: {
  heading: string;
  intro?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
  /** نص المعاينة في صندوق الوارد */
  preview?: string;
  /** شارة صغيرة أعلى العنوان، مثل "إيصال دفع" */
  badge?: string;
  tone?: EmailTone;
}): string {
  const { heading, intro, bodyHtml, ctaLabel, ctaUrl, footerNote, badge } = opts;
  const t = TONE[opts.tone ?? "default"];
  const host = appBaseUrl().replace(/^https?:\/\//, "");

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="rtl" lang="ar" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheader(opts.preview ?? intro ?? heading)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:28px 12px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(22,35,61,0.08);">

    <!-- شريط الهوية -->
    <tr><td style="height:4px;background:${t.bar};line-height:4px;font-size:0;">&nbsp;</td></tr>

    <!-- الترويسة -->
    <tr><td style="padding:22px 28px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="right" style="vertical-align:middle;">
          <img src="${logoUrl()}" width="40" height="40" alt="المعاصر"
               style="display:inline-block;vertical-align:middle;width:40px;height:40px;border:0;border-radius:9px;" />
          <span style="display:inline-block;vertical-align:middle;padding-right:10px;font-family:${FONT};font-size:16px;font-weight:bold;color:${NAVY};">المعاصر</span>
        </td>
        <td align="left" style="vertical-align:middle;font-family:${FONT};font-size:11px;color:${MUTED};letter-spacing:.4px;">
          Almoaser AI ERP
        </td>
      </tr></table>
    </td></tr>

    <!-- المحتوى -->
    <tr><td style="padding:14px 28px 4px;font-family:${FONT};">
      ${badge ? `<span style="display:inline-block;background:${t.chipBg};color:${t.chipInk};font-size:11.5px;font-weight:bold;padding:5px 11px;border-radius:99px;margin-bottom:12px;">${badge}</span>` : ""}
      <h1 style="margin:6px 0 10px;font-family:${FONT};font-size:21px;line-height:1.5;font-weight:bold;color:${INK};">${heading}</h1>
      ${intro ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:14.5px;line-height:1.95;color:${MUTED};">${intro}</p>` : ""}
      ${bodyHtml ?? ""}
      ${ctaLabel && ctaUrl ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr>
        <td align="center" bgcolor="${NAVY}" style="border-radius:10px;">
          <a href="${ctaUrl}" style="display:inline-block;padding:13px 30px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;background:${NAVY};">${ctaLabel}</a>
        </td>
      </tr></table>
      <p style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.7;color:#98a5bb;">
        لا يعمل الزر؟ انسخ هذا الرابط في المتصفح:<br />
        <span style="color:${NAVY_SOFT};word-break:break-all;">${ctaUrl}</span>
      </p>` : ""}
    </td></tr>

    <!-- التذييل -->
    <tr><td style="padding:22px 28px 26px;">
      <div style="height:1px;background:${HAIRLINE};line-height:1px;font-size:0;margin-bottom:16px;">&nbsp;</div>
      ${footerNote ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:11.5px;line-height:1.85;color:#98a5bb;">${footerNote}</p>` : ""}
      <p style="margin:0;font-family:${FONT};font-size:11.5px;line-height:1.85;color:${MUTED};">
        فريق <strong style="color:${NAVY};">المعاصر</strong> — نظام إدارة موارد الشركات بالذكاء الاصطناعي<br />
        <a href="${appBaseUrl()}" style="color:${GOLD};text-decoration:none;font-weight:bold;">${host}</a>
      </p>
    </td></tr>
  </table>

  <p style="margin:16px auto 0;max-width:600px;font-family:${FONT};font-size:10.5px;line-height:1.8;color:#9aa6bb;text-align:center;">
    هذه رسالة آلية من نظام المعاصر — يُرجى عدم الرد عليها مباشرة.
  </p>

</td></tr></table>
</body></html>`;
}

/** جدول بنود/قيم — يُستخدم في الإيصالات وتفاصيل الاشتراك */
export function renderRows(rows: Array<{ label: string; value: string; bold?: boolean }>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 2px;background:#fbfcfe;border:1px solid ${HAIRLINE};border-radius:12px;">
    ${rows.map((r, i) => `<tr>
      <td style="padding:12px 16px;font-family:${FONT};font-size:13.5px;color:${MUTED};${i > 0 ? `border-top:1px solid ${HAIRLINE};` : ""}white-space:nowrap;">${r.label}</td>
      <td align="left" style="padding:12px 16px;font-family:${FONT};font-size:${r.bold ? "16px" : "13.5px"};color:${r.bold ? NAVY : INK};${i > 0 ? `border-top:1px solid ${HAIRLINE};` : ""}${r.bold ? "font-weight:bold;" : ""}">${r.value}</td>
    </tr>`).join("")}
  </table>`;
}

/** صندوق بارز لعرض رمز تحقق (OTP) بخط كبير متباعد */
export function renderCode(code: string, note?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 2px;"><tr>
    <td align="center" style="background:#f7f9fd;border:1px solid ${HAIRLINE};border-radius:14px;padding:22px 16px;">
      <div style="font-family:${FONT};font-size:11.5px;color:${MUTED};margin-bottom:8px;">رمز التحقق</div>
      <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:9px;color:${NAVY};direction:ltr;">${code}</div>
      ${note ? `<div style="font-family:${FONT};font-size:11.5px;color:${MUTED};margin-top:10px;">${note}</div>` : ""}
    </td>
  </tr></table>`;
}
