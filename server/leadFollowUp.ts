// ─── متابعة العملاء المحتملين ────────────────────────────────────────────────
//
// خمسة سجلات في القاعدة كلها بحالة "جديد" منذ أيام. الجمع بلا متابعة يساوي
// عدمه: من كتب اسمه ومدينته ونشاطه أبدى نيّة، وتركُه أسبوعاً يجعله يشتري من
// غيرنا أو ينسى.
//
// التذكير بالبريد مؤقت حتى يُربط تيليجرام — الوجهة تتغيّر والمنطق لا.

import { getDb } from "./db";
import { salesLeads } from "../drizzle/schema";
import { and, eq, lt, isNull, or, gte, desc } from "drizzle-orm";
import { sendEmail } from "./email";
import { sendTelegram, tg, isTelegramConfigured } from "./telegram";

/** لا يُذكَّر بعميل قبل مرور هذه المدة: التذكير الفوري ضجيج لا متابعة. */
const STALE_HOURS = 20;
/** بعدها يسقط من التذكير اليومي — من لم يُتابَع شهراً لا يعالجه تذكير يومي. */
const GIVE_UP_DAYS = 30;

export type PendingLead = {
  id: number;
  name: string;
  phone: string | null;
  city: string | null;
  activity: string | null;
  employees: number | null;
  createdAt: Date;
  hoursWaiting: number;
};

/**
 * من ينتظر متابعة بشرية الآن.
 *
 * "جديد" فقط: من وُسم بأنه تُوُوصِل معه أو رفض أو تحوّل خرج من الطابور — وإلا
 * صار التذكير يعيد نفسه على من عولج فعلاً، وهذا ما يجعل الناس تتجاهل التذكير.
 */
export async function pendingLeads(now = new Date()): Promise<PendingLead[]> {
  const db = await getDb();
  if (!db) return [];
  const staleBefore = new Date(now.getTime() - STALE_HOURS * 3600_000);
  const giveUpBefore = new Date(now.getTime() - GIVE_UP_DAYS * 86400_000);

  const rows = await db.select().from(salesLeads)
    .where(and(
      eq(salesLeads.status, "new"),
      lt(salesLeads.createdAt, staleBefore),
      gte(salesLeads.createdAt, giveUpBefore),
    ))
    .orderBy(desc(salesLeads.createdAt))
    .limit(50);

  return rows.map(r => ({
    id: r.id, name: r.name, phone: r.phone, city: r.city,
    activity: r.activity, employees: r.employees, createdAt: r.createdAt,
    hoursWaiting: Math.floor((now.getTime() - r.createdAt.getTime()) / 3600_000),
  }));
}

/** الأحدث أولاً في العرض، لكن الترتيب بالأهمية: من ترك جواله أقرب للشراء. */
function rank(l: PendingLead): number {
  return (l.phone ? 100 : 0) + (l.activity ? 10 : 0) + (l.city ? 5 : 0) + (l.employees ? 5 : 0);
}

export function buildDigestHtml(leads: PendingLead[]): string {
  const sorted = [...leads].sort((a, b) => rank(b) - rank(a) || b.hoursWaiting - a.hoursWaiting);
  const row = (l: PendingLead) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #eee"><strong>${esc(l.name)}</strong></td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;direction:ltr;text-align:right">${l.phone ? esc(l.phone) : "<span style='color:#999'>لا جوال</span>"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">${esc(l.city ?? "—")}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee">${esc(l.activity ?? "—")}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #eee;white-space:nowrap">${toArabicDigits(String(l.hoursWaiting))} ساعة</td>
    </tr>`;
  return `
  <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;direction:rtl;text-align:right;color:#22335a">
    <h2 style="margin:0 0 6px">عملاء محتملون ينتظرون متابعة</h2>
    <p style="margin:0 0 16px;color:#666">${toArabicDigits(String(sorted.length))} سجلاً لم يُتابَع بعد. من ترك جواله في الأعلى — هو الأقرب للشراء.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="background:#f6f7fa">
        <th style="padding:10px 12px;text-align:right">الاسم</th>
        <th style="padding:10px 12px;text-align:right">الجوال</th>
        <th style="padding:10px 12px;text-align:right">المدينة</th>
        <th style="padding:10px 12px;text-align:right">النشاط</th>
        <th style="padding:10px 12px;text-align:right">منتظر</th>
      </tr></thead>
      <tbody>${sorted.map(row).join("")}</tbody>
    </table>
    <p style="margin:18px 0 0;font-size:13px;color:#666">
      وسمُ العميل بأنه تُوُوصِل معه يوقف تذكيره — من لوحة التحكم ← العملاء المحتملون.
    </p>
  </div>`;
}

const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
const toArabicDigits = (s: string) => s.replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/** نصّ الملخّص لتيليجرام — الجدول لا يُقرأ على شاشة جوال، فالسطور تُقرأ. */
export function buildDigestText(leads: PendingLead[]): string {
  const sorted = [...leads].sort((a, b) => rank(b) - rank(a) || b.hoursWaiting - a.hoursWaiting);
  const line = (l: PendingLead) => {
    const bits = [l.city, l.activity, l.employees ? `${toArabicDigits(String(l.employees))} موظفين` : null]
      .filter(Boolean).join(" · ");
    // الجوال بصيغة قابلة للنقر: الهدف أن يُتصل به لا أن يُقرأ
    const phone = l.phone ? `\n   📞 <code>${tg(l.phone)}</code>` : "\n   <i>لم يترك جوالاً</i>";
    return `• <b>${tg(l.name)}</b>${bits ? ` — ${tg(bits)}` : ""}${phone}\n   ⏱ منتظر ${toArabicDigits(String(l.hoursWaiting))} ساعة`;
  };
  return [
    `<b>عملاء محتملون ينتظرون متابعة</b>`,
    `${toArabicDigits(String(sorted.length))} سجلاً — من ترك جواله أولاً.`,
    "",
    sorted.slice(0, 15).map(line).join("\n\n"),
    sorted.length > 15 ? `\n<i>و${toArabicDigits(String(sorted.length - 15))} غيرهم في لوحة التحكم</i>` : "",
  ].filter(Boolean).join("\n");
}

/**
 * تذكير يومي واحد لا رسالة لكل عميل.
 *
 * الرسالة لكل سجل تُغرق البريد فتُصفَّى تلقائياً وتُقرأ كلها أو لا شيء منها.
 * الملخّص الواحد يُقرأ.
 */
export async function sendLeadDigest(): Promise<{
  sent: boolean; count: number; via: Array<"telegram" | "email">; reason?: string;
}> {
  const leads = await pendingLeads();
  if (!leads.length) return { sent: false, count: 0, via: [], reason: "لا سجلات تنتظر" };

  const via: Array<"telegram" | "email"> = [];
  const problems: string[] = [];

  // تيليجرام أولاً: يصل حيث يُقرأ في دقائق، والبريد يُصفّى ويُقرأ متأخراً
  if (isTelegramConfigured()) {
    const t = await sendTelegram(buildDigestText(leads));
    if (t.ok) via.push("telegram"); else problems.push(`تيليجرام: ${t.error}`);
  }

  // البريد بديل لا مستبدَل: يُرسَل حين لا تيليجرام أو حين فشل — تنبيه ضائع
  // بصمت أسوأ من تنبيه مكرر.
  const to = process.env.LEADS_DIGEST_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();
  if (to && !via.includes("telegram")) {
    const r = await sendEmail({
      to,
      subject: `${toArabicDigits(String(leads.length))} عميل محتمل ينتظر متابعة — المعاصر AI`,
      html: buildDigestHtml(leads),
    });
    if (r.ok) via.push("email"); else if (r.error) problems.push(`البريد: ${r.error}`);
  }
  if (!to && !via.length) problems.push("لا وجهة مضبوطة (TELEGRAM_CHAT_ID أو LEADS_DIGEST_EMAIL)");

  return { sent: via.length > 0, count: leads.length, via, reason: problems.join(" · ") || undefined };
}

export { STALE_HOURS, GIVE_UP_DAYS };
