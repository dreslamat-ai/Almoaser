import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the db module ───────────────────────────────────────────────────────
const mockConversations: Array<{ id: number; userId: number; title: string; createdAt: Date; updatedAt: Date }> = [];
const mockMessages: Array<{ id: number; conversationId: number; role: "user" | "assistant"; content: string; createdAt: Date }> = [];
let nextConvId = 1;
let nextMsgId = 1;

vi.mock("./db", async () => {
  return {
    getConversationsByUserId: vi.fn(async (userId: number) =>
      mockConversations.filter(c => c.userId === userId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())),
    getConversationById: vi.fn(async (id: number, userId: number) =>
      mockConversations.find(c => c.id === id && c.userId === userId)),
    createConversation: vi.fn(async (userId: number, title: string) => {
      const conv = { id: nextConvId++, userId, title, createdAt: new Date(), updatedAt: new Date() };
      mockConversations.push(conv);
      return conv.id;
    }),
    updateConversationTitle: vi.fn(async (id: number, userId: number, title: string) => {
      const conv = mockConversations.find(c => c.id === id && c.userId === userId);
      if (conv) conv.title = title;
    }),
    touchConversation: vi.fn(async (id: number) => {
      const conv = mockConversations.find(c => c.id === id);
      if (conv) conv.updatedAt = new Date();
    }),
    deleteConversation: vi.fn(async (id: number, userId: number) => {
      const idx = mockConversations.findIndex(c => c.id === id && c.userId === userId);
      if (idx === -1) throw new Error("المحادثة غير موجودة");
      mockConversations.splice(idx, 1);
      for (let i = mockMessages.length - 1; i >= 0; i--) {
        if (mockMessages[i].conversationId === id) mockMessages.splice(i, 1);
      }
    }),
    getMessagesByConversationId: vi.fn(async (conversationId: number) =>
      mockMessages.filter(m => m.conversationId === conversationId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())),
    addMessage: vi.fn(async (conversationId: number, role: "user" | "assistant", content: string, toolResults?: string) => {
      mockMessages.push({ id: nextMsgId++, conversationId, role, content, toolResults: toolResults ?? null, createdAt: new Date() } as never);
      const conv = mockConversations.find(c => c.id === conversationId);
      if (conv) conv.updatedAt = new Date();
    }),
  };
});

import * as db from "./db";

describe("سجل محادثات الوكيل", () => {
  beforeEach(() => {
    mockConversations.length = 0;
    mockMessages.length = 0;
    nextConvId = 1;
    nextMsgId = 1;
  });

  it("ينشئ محادثة جديدة بعنوان من أول رسالة", async () => {
    const id = await db.createConversation(1, "اعرض آخر الفواتير");
    expect(id).toBe(1);
    const convs = await db.getConversationsByUserId(1);
    expect(convs).toHaveLength(1);
    expect(convs[0].title).toBe("اعرض آخر الفواتير");
  });

  it("يحفظ رسائل المستخدم والوكيل بالترتيب", async () => {
    const id = await db.createConversation(1, "محادثة");
    await db.addMessage(id, "user", "اعرض العملاء");
    await db.addMessage(id, "assistant", "هذه قائمة العملاء...");
    const msgs = await db.getMessagesByConversationId(id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("يعزل محادثات كل مستخدم عن الآخر", async () => {
    await db.createConversation(1, "محادثة المستخدم الأول");
    await db.createConversation(2, "محادثة المستخدم الثاني");
    const user1 = await db.getConversationsByUserId(1);
    const user2 = await db.getConversationsByUserId(2);
    expect(user1).toHaveLength(1);
    expect(user2).toHaveLength(1);
    expect(user1[0].title).toBe("محادثة المستخدم الأول");
  });

  it("لا يعيد محادثة مستخدم آخر عبر getConversationById", async () => {
    const id = await db.createConversation(1, "خاصة");
    const conv = await db.getConversationById(id, 2);
    expect(conv).toBeUndefined();
  });

  it("يحذف المحادثة مع رسائلها", async () => {
    const id = await db.createConversation(1, "للحذف");
    await db.addMessage(id, "user", "مرحبا");
    await db.deleteConversation(id, 1);
    expect(await db.getConversationsByUserId(1)).toHaveLength(0);
    expect(await db.getMessagesByConversationId(id)).toHaveLength(0);
  });

  it("يرفض حذف محادثة مستخدم آخر", async () => {
    const id = await db.createConversation(1, "محمية");
    await expect(db.deleteConversation(id, 99)).rejects.toThrow();
  });

  it("يعيد تسمية المحادثة", async () => {
    const id = await db.createConversation(1, "قديم");
    await db.updateConversationTitle(id, 1, "عنوان جديد");
    const conv = await db.getConversationById(id, 1);
    expect(conv?.title).toBe("عنوان جديد");
  });

  it("يحفظ toolResults مع رسالة الوكيل ويستعيدها JSON صالح", async () => {
    const id = await db.createConversation(1, "محادثة بأدوات");
    const tr = JSON.stringify([{ tool_call_id: "1", tool_name: "get_invoices", display: "__INVOICES__[]" }]);
    await db.addMessage(id, "assistant", "هذه الفواتير", tr);
    const msgs = await db.getMessagesByConversationId(id);
    const saved = (msgs[0] as unknown as { toolResults: string | null }).toolResults;
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved!) as Array<{ tool_name: string }>;
    expect(parsed[0].tool_name).toBe("get_invoices");
  });

  it("ينشئ محادثة صريحة بعنوان افتراضي", async () => {
    const id = await db.createConversation(1, "محادثة جديدة");
    const conv = await db.getConversationById(id, 1);
    expect(conv?.title).toBe("محادثة جديدة");
  });
});
