import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock للنموذج المدمج قبل استيراد الوحدة
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({
    choices: [{ message: { role: "assistant", content: "builtin reply" } }],
  })),
}));

import { invokeAgentLLM, buildOpenAiPayload, OPENAI_MODEL } from "./llmProvider";
import { invokeLLM } from "./_core/llm";

const baseParams = {
  messages: [{ role: "user" as const, content: "مرحبا" }],
  maxTokens: 100,
};

describe("llmProvider", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // هذه الاختبارات تصف سلوك مسار OpenAI، وinvokeAgentLLM يجرّب OpenRouter أولاً.
    // كانت تمرّ سابقاً لأن المفتاح غائب من البيئة صدفةً لا قصداً — فلمّا صار
    // .env يُحمَّل انقلبت إلى فشل. الشرط يُفرض هنا صراحةً بدل الاتكال على الغياب.
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    if (originalRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalRouterKey;
    globalThis.fetch = originalFetch;
  });

  it("يستخدم OpenAI عند وجود المفتاح ونجاح الاستدعاء", async () => {
    process.env.OPENAI_API_KEY = "sk-test-valid";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "openai reply" } }],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const result = await invokeAgentLLM(baseParams);
    expect(result._provider).toBe("openai");
    expect(result.choices?.[0]?.message?.content).toBe("openai reply");
    expect(invokeLLM).not.toHaveBeenCalled();
    // التحقق من أن الطلب ذهب إلى OpenAI بالمفتاح الصحيح
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("api.openai.com");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-test-valid"
    );
  });

  it("يتحول تلقائياً للنموذج المدمج عند فشل OpenAI (رصيد منتهٍ 429)", async () => {
    process.env.OPENAI_API_KEY = "sk-test-noquota";
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), {
        status: 429,
      })
    ) as unknown as typeof fetch;

    const result = await invokeAgentLLM(baseParams);
    expect(result._provider).toBe("builtin");
    expect(result.choices?.[0]?.message?.content).toBe("builtin reply");
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("يستخدم النموذج المدمج مباشرة عند غياب مفتاح OpenAI", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await invokeAgentLLM(baseParams);
    expect(result._provider).toBe("builtin");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });

  it("يبني payload صحيحاً لـ OpenAI: النموذج والأدوات وmax_tokens", () => {
    const payload = buildOpenAiPayload({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: { name: "get_invoices", parameters: { type: "object" } },
        },
      ],
      tool_choice: "auto",
      maxTokens: 2000,
    });
    expect(payload.model).toBe(OPENAI_MODEL);
    expect(payload.max_tokens).toBe(2000);
    expect(payload.tool_choice).toBe("auto");
    expect(Array.isArray(payload.tools)).toBe(true);
    // حقول forge الخاصة لا تُمرر
    expect(payload).not.toHaveProperty("thinking");
    expect(payload).not.toHaveProperty("reasoning");
  });
});

// qwen3.5 استنتاجي: على "2+2" أنفق 672 توكن تفكير وأعاد content=null بحالة 200
describe("الرد الفارغ من موديل استنتاجي", () => {
  const originalRouterKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    if (originalRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalRouterKey;
    globalThis.fetch = originalFetch;
  });

  const reply = (content: unknown, finish = "stop", extra: object = {}) =>
    new Response(JSON.stringify({ choices: [{ message: { content, ...extra }, finish_reason: finish }] }), { status: 200 });

  it("ينتقل للموديل التالي بدل تسليم رد فارغ للعميل", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_MODEL = "model-a,model-b";
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      return call === 1 ? reply(null, "length") : reply("الإجابة");
    }) as unknown as typeof fetch;
    const { invokeAgentLLM } = await import("./llmProvider");
    const r = await invokeAgentLLM({ messages: [{ role: "user", content: "س" }], maxTokens: 100 } as never);
    expect(call).toBe(2);
    expect((r as { choices: Array<{ message: { content: string } }> }).choices[0].message.content).toBe("الإجابة");
  });

  it("يعدّ النص الفارغ والمسافات فشلاً كما يعدّ null", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_MODEL = "model-a,model-b";
    let call = 0;
    globalThis.fetch = vi.fn(async () => (++call === 1 ? reply("   ") : reply("تمام"))) as unknown as typeof fetch;
    const { invokeAgentLLM } = await import("./llmProvider");
    await invokeAgentLLM({ messages: [{ role: "user", content: "س" }], maxTokens: 100 } as never);
    expect(call).toBe(2);
  });

  // استدعاء أداة يأتي بلا نص وهو نجاح لا فشل — الخلط هنا يعطّل كل عمليات النظام
  it("لا يعدّ استدعاء أداة رداً فارغاً", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.LLM_MODEL = "model-a,model-b";
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      return reply(null, "tool_calls", { tool_calls: [{ id: "t1", function: { name: "get_invoices", arguments: "{}" } }] });
    }) as unknown as typeof fetch;
    const { invokeAgentLLM } = await import("./llmProvider");
    await invokeAgentLLM({ messages: [{ role: "user", content: "س" }], maxTokens: 100 } as never);
    expect(call).toBe(1);
  });
});
