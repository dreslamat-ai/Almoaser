// ─── مساعد إدارة المنصة ──────────────────────────────────────────────────────
//
// مساعد **صاحب المنصة** لا مساعد عملائها. بوت تيليجرام كان يوجّه رسائل المالك
// إلى وكيل المحاسبة، فيردّ عن ERPNext حين يُسأل عن اشتراك أو استهلاك — وهو
// مصمَّم لنظام العميل لا لإدارة المنصة. فصار للمالك وكيلٌ بأدواته هو.
//
// ## لا منطق جديد
// كل أداة هنا تنادي إجراءً قائماً في `admin` بنفس المستدعي (`createCaller`)
// الذي يبنيه الموقع. فالصلاحيات وسجل التدقيق يسريان كما يسريان من الشاشة، ولا
// يوجد طريقٌ خلفي يلتفّ عليهما.
//
// ## ويُنفَّذ لا يُعتذَر
// طلب المالك صريح: «ينفّذ معايا مايرفضش». فما يملك أداةً له يُنفَّذ فوراً بلا
// استئذان — هو صاحب المنصة والبيانات بياناته. وما لا أداة له يُقال بوضوح.
//
// ## وما لا يُفعَل
// لا حذف مستخدم ولا حذف اشتراك ولا مسح بيانات عميل. الإيقاف والتعديل يكفيان
// لكل ما طُلب، والحذف يقطع أثراً لا يُسترد — وهذه القاعدة نفسها في كل مساعِد
// عندنا.
import type { AppRouter } from "./routers";
import { logLlmUsage } from "./llmUsage";

type Caller = ReturnType<AppRouter["createCaller"]>;

const MODELS = ["qwen/qwen3.5-397b-a17b", "deepseek/deepseek-v4-flash"];
const MAX_ROUNDS = 4;
const BUDGET_MS = 45_000;

export const ADMIN_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "platform_overview",
      description: "لوحة المنصة الآن: التسجيلات والاشتراكات والإيراد وتكلفة النماذج ورصيد المزوّدين. تُستدعى لأي سؤال عام عن حال المنصة.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_users",
      description: "البحث عن مستخدمين بالاسم أو البريد أو الجوال، مع دورهم وحالتهم وتاريخ تسجيلهم.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "جزء من الاسم أو البريد أو الجوال" } },
        required: ["query"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "user_detail",
      description: "كل ما يخصّ مستخدماً: اشتراكه، رصيده، حالة ربطه بنظامه، ومدفوعاته.",
      parameters: {
        type: "object",
        properties: { userId: { type: "number", description: "رقم المستخدم من find_users" } },
        required: ["userId"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "erp_health",
      description: "فحص ربط كل العملاء بأنظمتهم ومعرفة من انكسر ربطه ولماذا.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_user_erp_connection",
      description: "تعديل إعدادات ربط مستخدم بنظامه (الرابط واسم المستخدم وكلمة السرّ). تُختبر البيانات قبل الحفظ فلا تُحفظ بيانات لا تعمل.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "number" },
          url: { type: "string", description: "رابط النظام" },
          username: { type: "string" },
          password: { type: "string" },
        },
        required: ["userId", "url", "username", "password"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "extend_subscription",
      description: "تمديد اشتراك مستخدم بعدد أيام.",
      parameters: {
        type: "object",
        properties: { userId: { type: "number" }, days: { type: "number", description: "عدد الأيام" } },
        required: ["userId", "days"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grant_credits",
      description: "منح رصيد لمستخدم.",
      parameters: {
        type: "object",
        properties: { userId: { type: "number" }, amount: { type: "number" }, note: { type: "string" } },
        required: ["userId", "amount"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_user_active",
      description: "تفعيل مستخدم أو إيقافه. الإيقاف بديل الحذف — لا حذف هنا بحال.",
      parameters: {
        type: "object",
        properties: { userId: { type: "number" }, active: { type: "boolean" } },
        required: ["userId", "active"], additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "llm_usage",
      description: "تفصيل استهلاك النماذج: من أنفق وعلى أي موديل، مع رصيد المزوّدين.",
      parameters: {
        type: "object",
        properties: { days: { type: "number", description: "عدد الأيام — الافتراضي 30" } },
        required: [], additionalProperties: false,
      },
    },
  },
];

const money = (n: unknown) => `${Number(n ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 })}`;

/** ينفّذ أداة إدارية عبر المستدعي نفسه الذي يستعمله الموقع */
export async function runAdminTool(caller: Caller, name: string, args: Record<string, unknown>): Promise<string> {
  const c = caller as unknown as { admin: Record<string, (i?: unknown) => Promise<unknown>> };

  switch (name) {
    case "platform_overview": {
      const [insights, revenue, balances] = await Promise.all([
        c.admin.platformInsights().catch(() => null),
        c.admin.revenueSummary().catch(() => null),
        c.admin.providerBalances().catch(() => null),
      ]);
      const b = balances as { balances?: Array<{ provider: string; remainingUsd: number | null; error?: string }> } | null;
      const bal = (b?.balances ?? [])
        .map(x => `${x.provider}: ${x.remainingUsd !== null ? "$" + x.remainingUsd.toFixed(2) : x.error ?? "—"}`)
        .join(" · ");
      return JSON.stringify({ insights, revenue, balances: bal }, null, 0).slice(0, 3500);
    }

    case "find_users": {
      const q = String(args.query ?? "").trim().toLowerCase();
      const all = (await c.admin.users().catch(() => [])) as Array<Record<string, unknown>>;
      const hit = all.filter(u =>
        [u.name, u.email, u.phone].some(v => String(v ?? "").toLowerCase().includes(q)),
      ).slice(0, 15);
      if (!hit.length) return `لا مستخدم يطابق «${args.query}».`;
      return hit.map(u => `#${u.id} · ${u.name} · ${u.email} · ${u.phone ?? "—"} · ${u.role} · ${u.isActive === false ? "موقوف" : "نشط"}`).join("\n");
    }

    case "user_detail": {
      const userId = Number(args.userId);
      const [subs, payments, health] = await Promise.all([
        c.admin.subscriptions().catch(() => []),
        c.admin.paymentsForUser({ userId }).catch(() => []),
        (async () => {
          const { checkErpConnections } = await import("./erpHealth");
          const r = await checkErpConnections();
          return r.broken.find(b => b.userId === userId) ?? null;
        })().catch(() => null),
      ]);
      const mySub = (subs as Array<Record<string, unknown>>).filter(s => Number(s.userId) === userId);
      return JSON.stringify({
        subscriptions: mySub,
        payments: (payments as unknown[]).slice(0, 10),
        erpConnection: health ? { ok: false, reason: (health as { reason: string }).reason } : { ok: true },
      }).slice(0, 3500);
    }

    case "erp_health": {
      const { checkErpConnections } = await import("./erpHealth");
      const { ok, broken } = await checkErpConnections();
      if (!broken.length) return `كل الاتصالات سليمة (${ok}).`;
      return `سليم ${ok} · معطوب ${broken.length}\n` +
        broken.map(b => `• #${b.userId} ${b.email} — ${b.url}\n  ${b.reason}`).join("\n");
    }

    case "set_user_erp_connection": {
      const r = await c.admin.setUserErpConnection({
        userId: Number(args.userId),
        url: String(args.url ?? ""),
        username: String(args.username ?? ""),
        password: String(args.password ?? ""),
      });
      return `تم حفظ الربط للمستخدم #${args.userId} بعد اختباره بنجاح. ${JSON.stringify(r)}`;
    }

    case "extend_subscription": {
      await c.admin.extendSubscriptionDays({ userId: Number(args.userId), days: Number(args.days) });
      return `مُدّد اشتراك المستخدم #${args.userId} بـ${args.days} يوماً.`;
    }

    case "grant_credits": {
      await c.admin.grantCredits({
        userId: Number(args.userId),
        amount: Number(args.amount),
        note: String(args.note ?? "منحة من المالك عبر تيليجرام"),
      });
      return `مُنح المستخدم #${args.userId} رصيد ${money(args.amount)}.`;
    }

    case "set_user_active": {
      await c.admin.setUserActive({ userId: Number(args.userId), isActive: Boolean(args.active) });
      return `${args.active ? "فُعّل" : "أُوقف"} المستخدم #${args.userId}.`;
    }

    case "llm_usage": {
      const days = Number(args.days ?? 30);
      const [byApp, balances] = await Promise.all([
        c.admin.llmUsageByApp({ days }),
        c.admin.providerBalances().catch(() => null),
      ]);
      return JSON.stringify({ byApp, balances }).slice(0, 3500);
    }

    default:
      return `لا أداة باسم ${name}.`;
  }
}

export function adminSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `أنت **مساعد إدارة منصة المعاصر AI** — تعمل مع مالك المنصة نفسه، لا مع عملائها.

اليوم ${today}.

## دورك
تدير معه المنصة: المستخدمون، الاشتراكات، الإيرادات، استهلاك النماذج ورصيدها، وربط العملاء بأنظمتهم. تجيب بأرقام من الأدوات لا بتقدير.

## نطاقك — وما ليس منه
أنت **لست** وكيل المحاسبة. لا تُنشئ فواتير عملاء ولا قيوداً في ERPNext ولا تشرح استعمال النظام للعملاء — ذلك عمل وكيل آخر. إن سُئلت عن شيء من ذلك قل إنه خارج دورك ووجّهه إلى المحادثة الذكية في المنصة.

## كيف تعمل
1. **نفّذ ولا تستأذن.** هو صاحب المنصة، والبيانات بياناته. ما تملك أداة له نفّذه فوراً ثم أخبره بما وقع. لا تسأل «هل تريد؟» قبل قراءة، ولا تعتذر عن صلاحية تملكها.
2. **ما لا أداة له قله صراحةً** ولا تخترع طريقاً ولا تدّعِ التنفيذ.
3. **الأرقام كما ردّتها الأداة**، بلا تقريب ولا إعادة حساب.
4. **لا تعلن نجاحاً لم ترُدّ به أداة.**
5. **لا حذف.** لا تحذف مستخدماً ولا اشتراكاً ولا بيانات عميل — ولا أداة لديك لذلك. الإيقاف بديل، والحذف يقطع أثراً لا يُسترد.
6. **رقم المستخدم قبل أي إجراء:** ابحث بـfind_users أولاً، ولا تخمّن رقماً. وإن تطابق أكثر من واحد اعرضهم واسأله أيّهم.

## أسلوبك
عربي مختصر مباشر. أرقام في أسطر لا فقرات. لا مقدّمات ولا خواتيم.`;
}

/** حلقة نموذج بأدوات إدارية */
export async function runAdminAgent(
  caller: Caller,
  messages: Array<{ role: string; content: string }>,
): Promise<{ reply: string | null; error?: string; calls: string[] }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { reply: null, error: "OPENROUTER_API_KEY غير مضبوط", calls: [] };

  const deadline = Date.now() + BUDGET_MS;
  const calls: string[] = [];
  let lastError = "";

  for (const model of MODELS) {
    if (Date.now() > deadline) break;
    const thread: Array<Record<string, unknown>> = [
      { role: "system", content: adminSystemPrompt() },
      ...messages,
    ];

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      let body: Record<string, unknown>;
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://erpsys.cloud",
            "X-Title": "Almoaser admin agent",
          },
          body: JSON.stringify({
            model, messages: thread,
            tools: round < MAX_ROUNDS ? ADMIN_TOOLS : undefined,
            tool_choice: round < MAX_ROUNDS ? "auto" : undefined,
            max_tokens: 1200, temperature: 0.2,
          }),
          signal: AbortSignal.timeout(25_000),
        });
        body = (await res.json()) as Record<string, unknown>;
        if (!res.ok) { lastError = `${model}: HTTP ${res.status}`; break; }
      } catch (e) {
        lastError = `${model}: ${e instanceof Error ? e.message : "خطأ"}`;
        break;
      }

      const choice = (body.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0];
      const msg = choice?.message;
      if (!msg) { lastError = `${model}: ردّ بلا رسالة`; break; }

      void logLlmUsage({
        app: "sara",
        provider: `openrouter:${model}`,
        usage: body.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
      });

      const toolCalls = (msg.tool_calls ?? []) as Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      if (!toolCalls.length) {
        const reply = String(msg.content ?? "").trim();
        if (!reply) { lastError = `${model}: ردّ فارغ`; break; }
        return { reply, calls };
      }

      thread.push(msg);
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "";
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>; } catch { /* وسائط معطوبة */ }
        calls.push(name);
        let out: string;
        try {
          out = await runAdminTool(caller, name, parsed);
        } catch (e) {
          //الخطأ يُنقل كما هو: «فشل» بلا سبب يجعل المالك يعيد المحاولة عمياً
          out = `فشلت الأداة: ${e instanceof Error ? e.message.slice(0, 300) : "خطأ غير معروف"}`;
        }
        thread.push({ role: "tool", tool_call_id: tc.id ?? `call_${calls.length}`, content: out });
      }
    }
  }

  return { reply: null, error: lastError || "تعذّر الوصول إلى النموذج", calls };
}
