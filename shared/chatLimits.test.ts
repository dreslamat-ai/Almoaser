import { describe, it, expect } from "vitest";
import { trimHistory, messageCreditCost, HISTORY_WINDOW, LONG_MESSAGE_CHARS } from "./chatLimits";

type M = { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: unknown[] };
const u = (c = "س"): M => ({ role: "user", content: c });
const a = (c = "ج"): M => ({ role: "assistant", content: c });
const call = (): M => ({ role: "assistant", content: "", tool_calls: [{ id: "t1" }] });
const res = (): M => ({ role: "tool", content: "نتيجة", tool_call_id: "t1" });

describe("trimHistory", () => {
  it("يترك التاريخ القصير كما هو", () => {
    const msgs = [u(), a(), u()];
    expect(trimHistory(msgs)).toBe(msgs);
  });

  it("يقصّ التاريخ الطويل", () => {
    const msgs = Array.from({ length: 100 }, (_, i) => (i % 2 ? a() : u()));
    const out = trimHistory(msgs);
    expect(out.length).toBeLessThanOrEqual(HISTORY_WINDOW);
    expect(out.length).toBeGreaterThan(0);
  });

  // الفخ الحقيقي: رسالة tool بلا assistant تحمل tool_calls تجعل النموذج يرفض الطلب
  it("لا يبدأ الناتج برسالة tool يتيمة أبداً", () => {
    for (let n = 30; n <= 80; n++) {
      // نمط متكرر: user → assistant(tool_calls) → tool → assistant
      const msgs: M[] = [];
      for (let i = 0; i < n; i++) {
        const k = i % 4;
        msgs.push(k === 0 ? u() : k === 1 ? call() : k === 2 ? res() : a());
      }
      const out = trimHistory(msgs);
      expect(out[0].role).not.toBe("tool");
      expect(out[0].tool_call_id).toBeUndefined();
    }
  });

  it("يبدأ الناتج دائماً برسالة user عند القصّ", () => {
    const msgs: M[] = [];
    for (let i = 0; i < 60; i++) msgs.push(i % 3 === 0 ? u() : i % 3 === 1 ? call() : res());
    const out = trimHistory(msgs);
    expect(out[0].role).toBe("user");
  });

  it("يُبقي التاريخ كما هو إن لم تكن فيه رسالة user داخل النافذة", () => {
    const msgs: M[] = [u(), ...Array.from({ length: 40 }, () => a())];
    expect(trimHistory(msgs)).toBe(msgs);
  });

  it("يحتفظ بآخر رسالة دائماً — هي سؤال العميل الحالي", () => {
    const msgs = Array.from({ length: 90 }, (_, i) => (i % 2 ? a() : u("q" + i)));
    const out = trimHistory(msgs);
    expect(out[out.length - 1]).toBe(msgs[msgs.length - 1]);
  });
});

describe("messageCreditCost", () => {
  it("الرسالة العادية بنقطة", () => {
    expect(messageCreditCost("أنشئ فاتورة")).toBe(1);
    expect(messageCreditCost("")).toBe(1);
    expect(messageCreditCost("x".repeat(LONG_MESSAGE_CHARS))).toBe(1);
  });

  it("الرسالة الطويلة بنقطتين", () => {
    expect(messageCreditCost("x".repeat(LONG_MESSAGE_CHARS + 1))).toBe(2);
    expect(messageCreditCost("x".repeat(4000))).toBe(2);
  });
});
