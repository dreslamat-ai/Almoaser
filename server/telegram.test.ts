import { describe, it, expect, vi, afterEach } from "vitest";
import { isTelegramConfigured, sendTelegram, tg, discoverChatId } from "./telegram";

const origFetch = globalThis.fetch;
const origToken = process.env.TELEGRAM_BOT_TOKEN;
const origChat = process.env.TELEGRAM_CHAT_ID;

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = origToken;
  if (origChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = origChat;
});

const reply = (status: number, body: object) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("tg — تهريب HTML", () => {
  // اسم عميل فيه < أو & يكسر الرسالة كلها لا حرفاً منها
  it("يهرّب المحارف التي تكسر الرسالة", () => {
    expect(tg('شركة <النور> & شركاه')).toBe("شركة &lt;النور&gt; &amp; شركاه");
  });

  it("يترك النص العربي العادي كما هو", () => {
    expect(tg("أحمد العتيبي")).toBe("أحمد العتيبي");
  });
});

describe("isTelegramConfigured", () => {
  it("يتطلّب التوكن والمحادثة معاً", () => {
    process.env.TELEGRAM_BOT_TOKEN = "t"; delete process.env.TELEGRAM_CHAT_ID;
    expect(isTelegramConfigured()).toBe(false);
    process.env.TELEGRAM_CHAT_ID = "123";
    expect(isTelegramConfigured()).toBe(true);
  });
});

describe("sendTelegram — سبب الرفض كما ذكره تيليجرام", () => {
  const configure = () => { process.env.TELEGRAM_BOT_TOKEN = "1:x"; process.env.TELEGRAM_CHAT_ID = "9"; };

  it("لا يرسل بلا ضبط ويقول ما ينقص", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID;
    const r = await sendTelegram("س");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("TELEGRAM_BOT_TOKEN");
  });

  // الحالتان تعطيان 400 لكن حلّيهما مختلفان تماماً
  it("يميّز المحادثة غير الموجودة عن التوكن الخاطئ", async () => {
    configure();
    globalThis.fetch = vi.fn(async () => reply(400, { description: "Bad Request: chat not found" })) as never;
    const r1 = await sendTelegram("س");
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("/start");

    globalThis.fetch = vi.fn(async () => reply(401, { description: "Unauthorized: bot token is invalid" })) as never;
    const r2 = await sendTelegram("س");
    if (!r2.ok) expect(r2.error).toContain("توكن");
  });

  it("ينجح عند رد سليم", async () => {
    configure();
    globalThis.fetch = vi.fn(async () => reply(200, { ok: true })) as never;
    expect(await sendTelegram("س")).toEqual({ ok: true });
  });

  it("يعطّل معاينة الروابط افتراضياً — الملخّص ليس مشاركة رابط", async () => {
    configure();
    const spy = vi.fn(async () => reply(200, { ok: true }));
    globalThis.fetch = spy as never;
    await sendTelegram("س");
    const body = JSON.parse((spy.mock.calls[0][1] as { body: string }).body);
    expect(body.link_preview_options.is_disabled).toBe(true);
    expect(body.parse_mode).toBe("HTML");
  });
});

describe("discoverChatId", () => {
  it("يوجّه لإرسال /start حين لا رسائل واردة", async () => {
    globalThis.fetch = vi.fn(async () => reply(200, { ok: true, result: [] })) as never;
    const r = await discoverChatId("1:x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("/start");
  });

  it("يجمع المحادثات بلا تكرار", async () => {
    globalThis.fetch = vi.fn(async () => reply(200, {
      ok: true,
      result: [
        { message: { chat: { id: 55, first_name: "إسلام" } } },
        { message: { chat: { id: 55, first_name: "إسلام" } } },
        { message: { chat: { id: -100, title: "مجموعة المبيعات" } } },
      ],
    })) as never;
    const r = await discoverChatId("1:x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chats).toHaveLength(2);
      expect(r.chats.map(c => c.id)).toEqual(["55", "-100"]);
    }
  });
});
