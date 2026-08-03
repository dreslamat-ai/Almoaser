/**
 * llmProvider — مزود النموذج الذكي للوكيل.
 *
 * الاستراتيجية:
 * 1. إن وُجد OPENROUTER_API_KEY: تجربة موديلات OpenRouter بترتيب LLM_MODEL
 *    (قائمة مفصولة بفواصل، افتراضياً qwen/qwen3.5-397b-a17b ثم
 *    deepseek/deepseek-v4-flash) — أول موديل ينجح يُستخدم.
 * 2. عند فشل كل موديلات OpenRouter: fallback إلى OpenAI مباشرة (gpt-4.1) إن
 *    وُجد مفتاحه.
 * 3. عند فشل الاثنين (أو غياب مفاتيحهما): fallback أخير للنموذج المدمج
 *    (Manus built-in LLM).
 */
import { invokeLLM } from "./_core/llm";

// نستخدم نفس أنواع رسائل invokeLLM لضمان توافق نقطة الاستدعاء في agent.ts
// إضافتان لا يعرفهما المزوّد المدمج: ترتيبُ موديلاتٍ لهذا النداء، وإضافات
// OpenRouter (محلّل الملفّات). تُعرَّف هنا كي تُمرَّر بأنواعها لا بتحويل.
type InvokeParams = Parameters<typeof invokeLLM>[0] & {
  preferModels?: string[];
  plugins?: unknown;
};
type InvokeResult = Awaited<ReturnType<typeof invokeLLM>>;

/**
 * رد بلا نص = فشل، لا نجاح.
 *
 * موديل استنتاجي قد ينفق الميزانية كلها في التفكير فيعيد content=null بحالة
 * 200 و finish_reason="length" — قياساً على الحالة وحدها يبدو ناجحاً، فيصل
 * للعميل ردٌّ فارغ بلا رسالة خطأ ولا تحويل لموديل آخر. رفعُ الخطأ هنا يجعل
 * السلسلة تنتقل للموديل التالي بدل تسليم الفراغ.
 *
 * استدعاء الأداة يأتي بلا نص وهو نجاح: الخلط بينهما يعطّل كل عمليات النظام.
 */
function assertNonEmptyReply(parsed: InvokeResult, label: string): void {
  const choice = (parsed as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] }; finish_reason?: string }>;
  }).choices?.[0];
  if (choice?.message?.tool_calls?.length) return;
  const content = choice?.message?.content;
  const empty = content === null || content === undefined
    || (typeof content === "string" && content.trim() === "");
  if (empty) {
    throw new Error(`${label} أعاد رداً فارغاً (finish_reason=${choice?.finish_reason ?? "?"})`);
  }
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODEL = "gpt-4.1";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** مهلة النداء الواحد — بعدها تنتقل السلسلة إلى الموديل التالي */
const MODEL_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);

const DEFAULT_OPENROUTER_MODELS = [
  "qwen/qwen3.5-397b-a17b",
  "deepseek/deepseek-v4-flash",
];

/** قائمة موديلات OpenRouter بترتيب الأولوية (من LLM_MODEL أو الافتراضي). */
export const getOpenRouterModels = (): string[] => {
  const raw = process.env.LLM_MODEL?.trim();
  if (!raw) return DEFAULT_OPENROUTER_MODELS;
  const list = raw.split(",").map(m => m.trim()).filter(Boolean);
  return list.length > 0 ? list : DEFAULT_OPENROUTER_MODELS;
};

const getOpenAiKey = (): string | undefined => {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
};

const getOpenRouterKey = (): string | undefined => {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
};

/**
 * تحويل معاملات invokeLLM إلى payload متوافق مع OpenAI-style chat/completions
 * (يستخدمه كل من OpenAI و OpenRouter — نفس الصيغة تقريباً).
 * صيغة الرسائل والأدوات متطابقة تقريباً، مع فروقات:
 * - model يُمرَّر صراحة (gpt-4.1 لـ OpenAI أو أحد موديلات LLM_MODEL لـ OpenRouter)
 * - حقول thinking/reasoning الخاصة بـ forge تُحذف
 * - max_tokens تُمرر كما هي
 */
export const buildOpenAiPayload = (
  params: InvokeParams,
  model: string = OPENAI_MODEL
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    model,
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
  // إضافات OpenRouter (محلّل الملفّات لقراءة PDF). OpenAI يتجاهل ما لا يعرف،
  // ولا تُرسل إلا حين تُطلب فلا تمسّ بقيّة النداءات.
  if (params.plugins) payload.plugins = params.plugins;
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
    body: JSON.stringify(buildOpenAiPayload(params, OPENAI_MODEL)),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenAI invoke failed: ${response.status} ${response.statusText} - ${errorText.slice(0, 300)}`
    );
  }
  const parsed = (await response.json()) as InvokeResult;
  assertNonEmptyReply(parsed, "OpenAI");
  return parsed;
};

/** استدعاء OpenRouter بموديل محدد. يرمي خطأً عند أي فشل. */
const invokeOpenRouterModel = async (
  params: InvokeParams,
  apiKey: string,
  model: string,
  timeoutMs = MODEL_TIMEOUT_MS,
): Promise<InvokeResult> => {
  // **مهلةٌ على كل نداء.** بلا مهلة، موديلٌ بطيء يعلّق الطلب إلى ما لا نهاية
  // ولا تصل النوبةُ إلى الموديل التالي في السلسلة. وقع ذلك في قراءة المستندات:
  // نداءٌ واحد استغرق تسعاً وثلاثين وثلاثمئة ثانية والعميل أمام دوّار لا يقف.
  // والانقطاع خطأٌ يُلتقط، فتنتقل السلسلة إلى ما بعده بدل أن تنتظر.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildOpenAiPayload(params, model)),
    });
  } catch (e) {
    throw (e as Error)?.name === "AbortError"
      ? new Error(`OpenRouter (${model}) تجاوز المهلة ${Math.round(timeoutMs / 1000)}ث`)
      : e;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter invoke failed (${model}): ${response.status} ${response.statusText} - ${errorText.slice(0, 300)}`
    );
  }
  const parsed = (await response.json()) as InvokeResult;
  assertNonEmptyReply(parsed, `OpenRouter (${model})`);
  return parsed;
};

/** يجرّب موديلات OpenRouter بالترتيب حتى ينجح واحد منها. */
const invokeOpenRouter = async (
  params: InvokeParams,
  apiKey: string
): Promise<InvokeResult & { _model: string }> => {
  // **الترتيب قد يخصّ النداء لا المنصّة كلّها.** بعض المهامّ لها موديلٌ أليق
  // بها، وتغييرُ `LLM_MODEL` لأجلها يغيّره على كل شيء.
  const preferred = params.preferModels;
  const models = preferred?.length
    ? [...preferred, ...getOpenRouterModels().filter(m => !preferred.includes(m))]
    : getOpenRouterModels();
  let lastError: unknown;
  for (const model of models) {
    try {
      const result = await invokeOpenRouterModel(params, apiKey, model);
      return { ...result, _model: model };
    } catch (error) {
      lastError = error;
      console.warn(
        `[llmProvider] OpenRouter model ${model} failed:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All OpenRouter models failed");
};

/**
 * استدعاء بموديل مُسمّى، بلا سلسلة الاحتياط.
 * يُستعمل حين تكون خصائص الموديل جزءاً من المتطلب لا تفصيلاً: شات المبيعات
 * يحتاج ردّاً في ثوانٍ، والموديل الاستنتاجي الافتراضي ينفق عشرات الثواني في
 * التفكير قبل أن يبدأ الرد — وهو صواب للمحاسبة وخطأ لزائر ينتظر أمام الشاشة.
 */
export async function invokeNamedModel(
  params: InvokeParams,
  model: string,
): Promise<InvokeResult & { _provider: string }> {
  const key = getOpenRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  const result = await invokeOpenRouterModel(params, key, model);
  return { ...result, _provider: `openrouter:${model}` };
}

/**
 * نقطة الاستدعاء الموحدة للوكيل: OpenRouter أولاً (بترتيب موديلات LLM_MODEL)،
 * ثم OpenAI المباشر، ثم fallback أخير للنموذج المدمج. تُرجع أيضاً اسم المزود
 * المستخدم لأغراض السجلات.
 */
export async function invokeAgentLLM(
  params: InvokeParams
): Promise<InvokeResult & { _provider?: string }> {
  const openRouterKey = getOpenRouterKey();
  if (openRouterKey) {
    try {
      const result = await invokeOpenRouter(params, openRouterKey);
      return { ...result, _provider: `openrouter:${result._model}` };
    } catch (error) {
      console.warn(
        "[llmProvider] OpenRouter (all models) failed, falling back to OpenAI:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

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
 * فحص خفيف لمفتاح OpenRouter: استدعاء بأقل تكلفة ممكنة (max_tokens=1) لكل
 * موديل في القائمة. يُستخدم للتشخيص فقط — لا يكشف قيمة المفتاح.
 */
export async function pingOpenRouter(): Promise<{
  hasKey: boolean;
  results?: Array<{ model: string; status?: number; ok?: boolean; error?: string }>;
}> {
  const raw = process.env.OPENROUTER_API_KEY;
  if (!raw || raw.trim().length === 0) return { hasKey: false };
  const key = raw.replace(/\u0000/g, "").trim();
  const models = getOpenRouterModels();

  const results = await Promise.all(
    models.map(async model => {
      try {
        const r = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        });
        const body = await r.text().catch(() => "");
        return {
          model,
          status: r.status,
          ok: r.ok,
          error: r.ok ? undefined : body.slice(0, 200),
        };
      } catch (e) {
        return { model, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  return { hasKey: true, results };
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
