import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { normalizeArabicName, findLeadByIdentity, upsertLead, updateLead, getLead } from "./salesLeads";
import { getDb } from "./db";
import { salesLeads } from "../drizzle/schema";
import { like, eq, or } from "drizzle-orm";

const TAG = `vitest-lead-${Date.now()}`;

describe("normalizeArabicName", () => {
  it("يوحّد صور الألف والتاء المربوطة والتشكيل", () => {
    expect(normalizeArabicName("أحمد")).toBe(normalizeArabicName("احمد"));
    expect(normalizeArabicName("حمزة")).toBe(normalizeArabicName("حمزه"));
    expect(normalizeArabicName("عَلِي")).toBe(normalizeArabicName("علي"));
  });

  it("يوحّد المسافات الزائدة", () => {
    expect(normalizeArabicName("  خالد   العتيبي ")).toBe("خالد العتيبي");
  });

  it("لا يخلط بين اسمين مختلفين", () => {
    expect(normalizeArabicName("احمد")).not.toBe(normalizeArabicName("محمد"));
  });
});

describe("منع تكرار العميل المحتمل", () => {
  const ids: number[] = [];
  const track = (id?: number) => { if (id && !ids.includes(id)) ids.push(id); return id; };

  afterAll(async () => {
    const db = await getDb();
    if (!db || !ids.length) return;
    for (const id of ids) await db.delete(salesLeads).where(eq(salesLeads.id, id));
  });

  // الحالة التي وقعت فعلاً: خمسة صفوف باسم "احمد" في دقيقة واحدة
  it("لا ينشئ صفاً ثانياً حين يعود نفس الاسم بمعلومة إضافية", async () => {
    const name = `${TAG}-احمد`;
    const first = track(await upsertLead({ name }));
    expect(first).toBeTruthy();
    await updateLead(first!, { city: "الدمام" });
    // رسالة تالية: نفس الاسم ومعه النشاط، بلا معرّف سجل (الجلسة انتهت)
    const second = track(await upsertLead({ name, activity: "حسابات" }));
    expect(second).toBe(first);
  });

  it("يلتحق الجوال بالسجل القائم بدل إنشاء سجل مكتمل بجواره", async () => {
    const name = `${TAG}-سالم`;
    const first = track(await upsertLead({ name, city: "الرياض" }));
    const withPhone = track(await upsertLead({ name, phone: "0551110001", city: "الرياض" }));
    expect(withPhone).toBe(first);
    const row = await getLead(first!);
    expect(row?.phone).toBe("+966551110001");
  });

  // الحد الفاصل: التعارض هو ما يفرّق بين شخصين يحملان اسماً شائعاً
  it("يفصل بين شخصين نفس الاسم ومدينتاهما مختلفتان", async () => {
    const name = `${TAG}-عبدالله`;
    const a = track(await upsertLead({ name, city: "الرياض" }));
    await updateLead(a!, { city: "الرياض" });
    const b = track(await upsertLead({ name, city: "جدة" }));
    expect(b).not.toBe(a);
  });

  it("الغياب ليس تعارضاً: اسم مجرّد يلتحق بسجل له مدينة", async () => {
    const name = `${TAG}-فهد`;
    const a = track(await upsertLead({ name }));
    await updateLead(a!, { city: "الدمام", activity: "مقاولات" });
    const b = track(await upsertLead({ name }));
    expect(b).toBe(a);
  });

  it("يعامل \"المقاولات\" و\"مقاولات\" نشاطاً واحداً", async () => {
    const name = `${TAG}-شركة`;
    const a = track(await upsertLead({ name, activity: "مقاولات" }));
    await updateLead(a!, { activity: "مقاولات" });
    const b = track(await upsertLead({ name, activity: "المقاولات" }));
    expect(b).toBe(a);
  });

  it("الجوال يظل المفتاح الأقوى حتى مع اختلاف الاسم", async () => {
    const a = track(await upsertLead({ name: `${TAG}-اسم-اول`, phone: "0551110002" }));
    const b = track(await upsertLead({ name: `${TAG}-اسم-ثان`, phone: "0551110002" }));
    expect(b).toBe(a);
  });

  it("لا يطابق اسماً أقصر من حرفين", async () => {
    expect(await findLeadByIdentity("ا")).toBeUndefined();
  });
});
