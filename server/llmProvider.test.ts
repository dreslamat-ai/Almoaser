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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
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
