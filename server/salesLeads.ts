// ─── العملاء المحتملون من شات المبيعات ────────────────────────────────────────
// تُجمع تدريجياً أثناء الحديث لا كاستمارة قبله: استمارة قبل الكلام تطرد الزائر
// الذي جاء يسأل عن السعر، فنخسر المحادثة والبيانات معاً. سارة تسأل حين يظهر
// الاهتمام، وحينها يعطي العميل بيانات صحيحة لأنه يريد شيئاً.
// السجل يُنشأ بأي بيانات ولو ناقصة — اسم ومدينة عميلٌ محتمل، وانتظار الاكتمال
// يعني ألا نحفظ شيئاً.

import { eq, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { salesLeads } from "../drizzle/schema";
import { normalizePhone } from "./phone";

export type LeadUpdate = {
  city?: string | null;
  activity?: string | null;
  employees?: number | null;
  interestedPlanId?: number | null;
};

export type LeadIdentity = { name?: string | null; phone?: string | null };

/**
 * ينشئ أو يحدّث عميلاً محتملاً بما توفّر.
 * المفتاح هو الجوال حين يوجد — العائد بعد أسبوع هو نفسه لا سجل ثانٍ. وقبل أن
 * يعطي رقمه نستعمل معرّف الجلسة الذي أنشأناه له.
 */
export async function upsertLead(input: LeadIdentity & { leadId?: number | null }): Promise<number | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  let phoneE164: string | null = null;
  if (input.phone?.trim()) {
    const n = normalizePhone(input.phone);
    if (n.ok) phoneE164 = n.e164;
  }

  if (phoneE164) {
    const byPhone = await db.select({ id: salesLeads.id }).from(salesLeads)
      .where(eq(salesLeads.phone, phoneE164)).limit(1);
    if (byPhone[0]) {
      if (input.name?.trim()) {
        await db.update(salesLeads).set({ name: input.name.trim().slice(0, 160) }).where(eq(salesLeads.id, byPhone[0].id));
      }
      return byPhone[0].id;
    }
  }

  if (input.leadId) {
    const set: Record<string, unknown> = {};
    if (input.name?.trim()) set.name = input.name.trim().slice(0, 160);
    if (phoneE164) set.phone = phoneE164;
    if (Object.keys(set).length) await db.update(salesLeads).set(set).where(eq(salesLeads.id, input.leadId));
    return input.leadId;
  }

  if (!input.name?.trim() && !phoneE164) return undefined;
  const values: Record<string, unknown> = {};
  if (input.name?.trim()) values.name = input.name.trim().slice(0, 160);
  if (phoneE164) values.phone = phoneE164;
  const inserted = await db.insert(salesLeads).values(values as never);
  return Number((inserted as unknown as [{ insertId: number }])[0]?.insertId ?? 0) || undefined;
}

/** تحديث جزئي: لا يمحو ما سبق جمعه بقيمة فارغة وردت في رسالة لاحقة */
export async function updateLead(id: number, patch: LeadUpdate & { notes?: string }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (patch.city?.trim()) set.city = patch.city.trim().slice(0, 120);
  if (patch.activity?.trim()) set.activity = patch.activity.trim().slice(0, 255);
  if (typeof patch.employees === "number" && patch.employees > 0) set.employees = Math.min(patch.employees, 1_000_000);
  if (patch.interestedPlanId) set.interestedPlanId = patch.interestedPlanId;
  if (patch.notes?.trim()) set.notes = patch.notes.trim().slice(0, 4000);
  if (!Object.keys(set).length) return;
  await db.update(salesLeads).set(set).where(eq(salesLeads.id, id));
}

export async function getLead(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(salesLeads).where(eq(salesLeads.id, id)).limit(1);
  return rows[0];
}

export async function listLeads() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(salesLeads).orderBy(desc(salesLeads.createdAt)).limit(300);
}

export async function setLeadStatus(id: number, status: "new" | "contacted" | "converted" | "declined") {
  const db = await getDb();
  if (!db) return;
  await db.update(salesLeads).set({ status }).where(eq(salesLeads.id, id));
}

export async function countNewLeads(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(salesLeads).where(eq(salesLeads.status, "new"));
  return Number(r?.n ?? 0);
}

/** تطبيع الجوال بنفس قواعد التسجيل — رقم واحد بصيغتين ليس عميلين */
export function normalizeLeadPhone(raw: string) {
  return normalizePhone(raw);
}

/**
 * استخلاص بيانات العميل من نص المحادثة باستدعاء ثانٍ خفيف.
 *
 * الاعتماد على أن يُصدر الموديل علامة منظّمة مع ردّه غير موثوق — النماذج
 * المجانية المستخدمة هنا تتجاهلها كثيراً وتكتفي بذكر المعلومة في كلامها
 * الطبيعي. لذلك نستخلص بعد الرد لا معه، وفي الخلفية حتى لا يتأخر العميل.
 * يستخرج ما قاله العميل صراحةً فقط — لا يخمّن مدينة من لهجة ولا نشاطاً من اسم.
 */
export async function extractLeadFromConversation(
  messages: Array<{ role: string; content: string }>,
): Promise<LeadUpdate & { name?: string; phone?: string }> {
  const convo = messages.filter(m => m.role === "user").map(m => m.content).join("\n").slice(0, 3000);
  if (convo.trim().length < 5) return {};
  const { invokeNamedModel } = await import("./llmProvider");
  const { SALES_MODELS } = await import("./salesAgent");
  const prompt = `استخرج من كلام العميل التالي ما ذكره صراحةً فقط. لا تخمّن ولا تستنتج.
أعد JSON بالحقول المعروفة فقط واترك ما لم يُذكر فارغاً:
name (اسمه)، phone (جواله)، city (مدينته)، activity (نشاط شركته)، employees (عدد الموظفين كرقم).

كلام العميل:
${convo}`;
  for (const model of SALES_MODELS) {
    try {
      const res = await invokeNamedModel({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 300,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "lead", strict: true,
            schema: {
              type: "object",
              properties: {
                name: { type: "string" }, phone: { type: "string" }, city: { type: "string" },
                activity: { type: "string" }, employees: { type: "number" },
              },
              required: ["name", "phone", "city", "activity", "employees"],
              additionalProperties: false,
            },
          },
        },
      } as never, model);
      const raw = res?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") continue;
      const v = JSON.parse(raw) as Record<string, unknown>;
      const out: LeadUpdate & { name?: string; phone?: string } = {};
      for (const k of ["name", "phone", "city", "activity"] as const) {
        const s = typeof v[k] === "string" ? (v[k] as string).trim() : "";
        if (s && s !== "-" && s.length > 1) out[k] = s;
      }
      const emp = Number(v.employees);
      if (Number.isFinite(emp) && emp > 0) out.employees = Math.round(emp);
      return out;
    } catch { /* جرّب التالي */ }
  }
  return {};
}

/**
 * يلتقط ما جمعته سارة من علامات في ردّها.
 * نفس أسلوب زر التسجيل: الموديل يصدر علامة ونحن نفسّرها. استدعاء الأدوات غير
 * موثوق في النماذج المجانية المستخدمة هنا، والعلامة تعمل معها كلها.
 * الصيغة: [[LEAD:name=محمد;phone=0501234567;city=الرياض;activity=تجزئة;employees=12]]
 */
export function extractLeadInfo(reply: string): { text: string; patch: LeadUpdate & { name?: string; phone?: string } } {
  const m = reply.match(/\[\[\s*LEAD\s*:([^\]]*)\]\]/i);
  if (!m) return { text: reply, patch: {} };
  const patch: LeadUpdate & { name?: string; phone?: string } = {};
  for (const part of m[1].split(";")) {
    const [k, ...rest] = part.split("=");
    const key = k?.trim().toLowerCase();
    const val = rest.join("=").trim();
    if (!key || !val) continue;
    if (key === "name") patch.name = val;
    else if (key === "phone") patch.phone = val;
    else if (key === "city") patch.city = val;
    else if (key === "activity") patch.activity = val;
    else if (key === "employees") {
      const n = parseInt(val.replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n) && n > 0) patch.employees = n;
    }
  }
  const text = reply.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, patch };
}
