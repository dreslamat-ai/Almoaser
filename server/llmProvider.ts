/**
 * llmProvider — مزود النموذج الذكي للوكيل.
 *
 * الاستراتيجية:
 * 1. إن وُجد OPENAI_API_KEY: استدعاء OpenAI مباشرة (gpt-4.1) — يدفع المستخدم
 *    لمزود النموذج مباشرةً بدل استهلاك رصيد Manus.
 * 2. عند فشل OpenAI (مفتاح بلا رصيد 429، مفتاح خاطئ 401، عطل 5xx...):
 *    fallback تلقائي إلى النموذج المدمج (Manus built-in LLM).
 * 3. إن لم يوجد مفتاح OpenAI أصلاً: النموذج المدمج مباشرة.
 */
import { invokeLLM } from "./_core/llm";

// نستخدم نفس أنواع رسائل invokeLLM لضمان توافق نقطة الاستدعاء في agent.ts
type InvokeParams = Parameters<typeof invokeLLM>[0];
type InvokeResult = Awaited<ReturnType<typeof invokeLLM>>;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL = "gpt-4.1";

const getOpenAiKey = (): string | undefined => {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
};

/**
 * تحويل معاملات invokeLLM إلى payload متوافق مع OpenAI chat/completions.
 * صيغة الرسائل والأدوات متطابقة تقريباً (OpenAI-compatible)، مع فروقات:
 * - model يُفرض على gpt-4.1
 * - حقول thinking/reasoning الخاصة بـ forge تُحذف
 * - max_tokens تُمرر كما هي (مدعومة في gpt-4.1)
 */
export const buildOpenAiPayload = (
  params: InvokeParams
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    model: OPENAI_MODEL,
    messages: params.messages,
  };
  if (params.tools && params.tools.length > 0) {
    payload.tools = params.tools;
    const tc = params.toolChoice ?? params.tool_choice;
    if (tc) payload.tool_choice = tc;
  }
  const maxTokens = params.max_tokens ?? params.maxTokens;
  if (typeof maxTokens === "number") payload.max_tokens = maxTokens;
  const rf = params.responseFormat ?? params.response_format;
  if (rf) payload.response_format = rf;
  return payload;
};

/** استدعاء OpenAI مباشرة. يرمي خطأً عند أي فشل ليتولى المستدعي الـ fallback. */
const invokeOpenAI = async (
  params: InvokeParams,
  apiKey: string
): Promise<InvokeResult> => {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildOpenAiPayload(params)),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI invoke failed: ${response.status} ${response.statusText} – ${errorText.slice(0, 300)}`
    );
  }
  return (await response.json()) as InvokeResult;
};

/**
 * نقطة الاستدعاء الموحدة للوكيل: OpenAI أولاً (إن وُجد المفتاح) ثم fallback
 * للنموذج المدمج. تُرجع أيضاً اسم المزود المستخدم لأغراض السجلات.
 */
export async function invokeAgentLLM(
  params: InvokeParams
): Promise<InvokeResult & { _provider?: string }> {
  const openAiKey = getOpenAiKey();

  if (openAiKey) {
    try {
      const result = await invokeOpenAI(params, openAiKey);
      return { ...result, _provider: "openai" };
    } catch (error) {
      console.warn(
        "[llmProvider] OpenAI failed, falling back to built-in LLM:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const result = await invokeLLM(params);
  return { ...result, _provider: "builtin" };
}

/**
 * فحص خفيف لمفتاح OpenAI: استدعاء بأقل تكلفة ممكنة (max_tokens=1).
 * يُستخدم للتشخيص فقط — لا يكشف قيمة المفتاح.
 */
export async function pingOpenAI(): Promise<{
  hasKey: boolean;
  keyHasNul?: boolean;
  status?: number;
  ok?: boolean;
  error?: string;
}> {
  const raw = process.env.OPENAI_API_KEY;
  if (!raw || raw.trim().length === 0) return { hasKey: false };
  const keyHasNul = raw.includes("\u0000");
  const key = raw.replace(/\u0000/g, "").trim();
  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    const body = await r.text().catch(() => "");
    return {
      hasKey: true,
      keyHasNul,
      status: r.status,
      ok: r.ok,
      error: r.ok ? undefined : body.slice(0, 200),
    };
  } catch (e) {
    return {
      hasKey: true,
      keyHasNul,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
/**
 * فحص خفيف لبيانات اعتماد ERPNext الافتراضية: تسجيل دخول فعلي.
 * لا يكشف كلمة المرور — يعيد فقط حالة النجاح واسم المستخدم المسجَّل.
 */
export async function pingErpNext(): Promise<{
  hasConfig: boolean;
  url?: string;
  status?: number;
  ok?: boolean;
  loggedInAs?: string;
  error?: string;
}> {
  const url = (process.env.ERPNEXT_URL ?? "").replace(/\u0000/g, "").trim().replace(/\/+$/, "");
  const usr = (process.env.ERPNEXT_USERNAME ?? "").replace(/\u0000/g, "").trim();
  const pwd = (process.env.ERPNEXT_PASSWORD ?? "").replace(/\u0000/g, "");
  if (!url || !usr || !pwd) return { hasConfig: false };
  try {
    const r = await fetch(`${url}/api/method/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr, pwd }),
    });
    const sid = (r.headers.get("set-cookie") ?? "").match(/sid=([^;]+)/)?.[1];
    const body = await r.text().catch(() => "");
    let fullName: string | undefined;
    try { fullName = (JSON.parse(body) as { full_name?: string }).full_name; } catch { /* ignore */ }
    const ok = r.ok && !!sid && sid !== "Guest";
    return {
      hasConfig: true,
      url,
      status: r.status,
      ok,
      loggedInAs: ok ? fullName : undefined,
      error: ok ? undefined : body.slice(0, 150),
    };
  } catch (e) {
    return { hasConfig: true, url, error: e instanceof Error ? e.message : String(e) };
  }
}
