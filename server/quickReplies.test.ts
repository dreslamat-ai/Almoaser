/**
 * اختبارات استخراج أزرار الإجابات السريعة (Quick Replies) من رد الوكيل
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { extractQuickReplies } from "./agent/quickReplies";
import * as dbHelpers from "./db";

describe("extractQuickReplies", () => {
  it("يستخرج الخيارات من سطر QUICK_REPLIES ويحذفه من النص", () => {
    const raw = "هل تريد اعتماد الفاتورة ACC-SINV-2026-00007؟\n[QUICK_REPLIES: نعم، اعتمدها | لا، اتركها مسودة]";
    const { text, quickReplies } = extractQuickReplies(raw);
    expect(quickReplies).toEqual(["نعم، اعتمدها", "لا، اتركها مسودة"]);
    expect(text).toBe("هل تريد اعتماد الفاتورة ACC-SINV-2026-00007؟");
    expect(text).not.toContain("QUICK_REPLIES");
  });

  it("يعيد نصاً كما هو دون خيارات إن لم يوجد السطر", () => {
    const raw = "تم إنشاء الفاتورة بنجاح بقيمة 5000 ريال.";
    const { text, quickReplies } = extractQuickReplies(raw);
    expect(quickReplies).toEqual([]);
    expect(text).toBe(raw);
  });

  it("يتعامل مع نص فارغ", () => {
    const { text, quickReplies } = extractQuickReplies("");
    expect(quickReplies).toEqual([]);
    expect(text).toBe("");
  });

  it("يدعم خيارات متعددة حتى 4 وأكثر مع قصّها إلى 6 كحد أقصى", () => {
    const raw = "أي عميل تقصد؟\n[QUICK_REPLIES: أ | ب | ج | د | هـ | و | ز | ح]";
    const { quickReplies } = extractQuickReplies(raw);
    expect(quickReplies.length).toBe(6);
    expect(quickReplies[0]).toBe("أ");
  });

  it("يتجاهل الخيارات الفارغة والمسافات الزائدة", () => {
    const raw = "سؤال؟ [QUICK_REPLIES:  نعم  |  | لا ]";
    const { quickReplies } = extractQuickReplies(raw);
    expect(quickReplies).toEqual(["نعم", "لا"]);
  });

  it("يأخذ آخر سطر QUICK_REPLIES إن تكرر ويحذف الجميع من النص", () => {
    const raw = "[QUICK_REPLIES: قديم]\nالسؤال الفعلي؟\n[QUICK_REPLIES: نعم | لا]";
    const { text, quickReplies } = extractQuickReplies(raw);
    expect(quickReplies).toEqual(["نعم", "لا"]);
    expect(text).not.toContain("QUICK_REPLIES");
    expect(text).toContain("السؤال الفعلي؟");
  });

  it("يدعم خيارات بالإنجليزية أيضاً", () => {
    const raw = "Do you want to submit the invoice?\n[QUICK_REPLIES: Yes, submit it | No, keep as draft]";
    const { text, quickReplies } = extractQuickReplies(raw);
    expect(quickReplies).toEqual(["Yes, submit it", "No, keep as draft"]);
    expect(text).toBe("Do you want to submit the invoice?");
  });
});

describe("حفظ واستعادة quickReplies في سجل المحادثات", () => {
  let TEST_USER_ID = 0;

  beforeAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    const { users } = await import("../drizzle/schema");
    const openId = `test-quickreplies-${Date.now()}`;
    await db.insert(users).values({ openId, name: "QuickReplies Test" });
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(users).where(eq(users.openId, openId));
    TEST_USER_ID = rows[0].id;
  });

  afterAll(async () => {
    if (!TEST_USER_ID) return;
    const { getDb } = await import("./db");
    const db = await getDb();
    const { users } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("يحفظ quickReplies بالصيغة الجديدة مع رسالة الوكيل ويستعيدها", async () => {
    const convId = await dbHelpers.createConversation(TEST_USER_ID, "اختبار quick replies");
    const stored = JSON.stringify({
      toolResults: [{ tool_call_id: "tc1", tool_name: "get_invoices", display: "" }],
      quickReplies: ["نعم، اعتمدها", "لا، اتركها مسودة"],
    });
    await dbHelpers.addMessage(convId, "assistant", "هل أعتمد الفاتورة؟", stored);

    const messages = await dbHelpers.getMessagesByConversationId(convId);
    expect(messages.length).toBe(1);
    const parsed = JSON.parse(messages[0].toolResults!) as {
      toolResults: unknown[];
      quickReplies: string[];
    };
    expect(parsed.quickReplies).toEqual(["نعم، اعتمدها", "لا، اتركها مسودة"]);
    expect(Array.isArray(parsed.toolResults)).toBe(true);

    await dbHelpers.deleteConversation(convId, TEST_USER_ID);
  });

  it("الصيغة القديمة (مصفوفة toolResults فقط) تبقى قابلة للقراءة دون quickReplies", async () => {
    const convId = await dbHelpers.createConversation(TEST_USER_ID, "اختبار الصيغة القديمة");
    const legacy = JSON.stringify([{ tool_call_id: "tc1", tool_name: "get_customers", display: "x" }]);
    await dbHelpers.addMessage(convId, "assistant", "رد قديم", legacy);

    const messages = await dbHelpers.getMessagesByConversationId(convId);
    const parsed = JSON.parse(messages[0].toolResults!) as unknown;
    // الصيغة القديمة مصفوفة — الواجهة تتعامل معها عبر parseStoredToolResults
    expect(Array.isArray(parsed)).toBe(true);

    await dbHelpers.deleteConversation(convId, TEST_USER_ID);
  });
});
