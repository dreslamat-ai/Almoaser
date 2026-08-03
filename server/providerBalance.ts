// ─── رصيد المزوّدين ──────────────────────────────────────────────────────────
//
// الاستهلاك وحده لا يكفي: أن تعرف أنك أنفقت ثلاثة دولارات لا يقول لك متى يقف
// النظام. الرصيد المتبقّي هو الرقم الذي يُتّخذ عليه قرار الشحن، ومكانه بجوار
// الإنفاق لا في لوحة المزوّد.
//
// **ولا يُخمَّن رصيدٌ لم يُقرأ.** إن تعذّر النداء يُقال «تعذّر» ولا يُعرض صفر
// ولا آخر قيمة معروفة: رقمٌ قديم يُقرأ كأنه الآن، فيُطمئن حيث يجب أن يُنذر.

export type ProviderBalance = {
  provider: "openrouter" | "openai";
  /** المتبقّي بالدولار — null إن تعذّرت القراءة */
  remainingUsd: number | null;
  /** ما شُحن إجمالاً، إن أتاحه المزوّد */
  grantedUsd: number | null;
  usedUsd: number | null;
  /** سبب تعذّر القراءة، ليُعرض كما هو لا مُترجماً إلى صفر */
  error?: string;
};

const TIMEOUT_MS = 8000;

async function fetchJson(url: string, key: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new Error(String(msg).slice(0, 120));
  }
  return body;
}

/**
 * رصيد OpenRouter.
 *
 * `/api/v1/credits` يعيد ما شُحن وما استُهلك، والمتبقّي هو الفرق. وهو أدقّ من
 * جمع سجلّنا: يشمل ما أنفقته شهد ومن يشاركنا المفتاح، ويشمل رسوماً لا نراها.
 */
export async function getOpenRouterBalance(): Promise<ProviderBalance> {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key) return { provider: "openrouter", remainingUsd: null, grantedUsd: null, usedUsd: null, error: "لا مفتاح مضبوط" };

  try {
    const body = await fetchJson("https://openrouter.ai/api/v1/credits", key);
    const data = (body.data ?? body) as Record<string, unknown>;
    const granted = Number(data.total_credits ?? data.limit ?? NaN);
    const used = Number(data.total_usage ?? data.usage ?? NaN);

    if (!Number.isFinite(granted) || !Number.isFinite(used)) {
      return { provider: "openrouter", remainingUsd: null, grantedUsd: null, usedUsd: null, error: "صيغة غير متوقّعة من المزوّد" };
    }

    return {
      provider: "openrouter",
      remainingUsd: Math.max(0, granted - used),
      grantedUsd: granted,
      usedUsd: used,
    };
  } catch (e) {
    return {
      provider: "openrouter", remainingUsd: null, grantedUsd: null, usedUsd: null,
      error: e instanceof Error ? e.message : "تعذّر النداء",
    };
  }
}

/**
 * رصيد OpenAI.
 *
 * **لا واجهة عامة للرصيد المتبقّي.** أوقفت OpenAI نقطة `dashboard/billing`
 * للمفاتيح العادية، ولا تُتاح إلا لمفتاح إداري. فيُقرأ ما أمكن — الإنفاق عبر
 * `organization/costs` — ويُصرَّح بأن المتبقّي غير متاح بدل اختراعه.
 */
export async function getOpenAiBalance(): Promise<ProviderBalance> {
  const key = process.env.OPENAI_ADMIN_KEY ?? "";
  if (!key) {
    return {
      provider: "openai", remainingUsd: null, grantedUsd: null, usedUsd: null,
      error: "يحتاج مفتاح إدارة (OPENAI_ADMIN_KEY) — المفتاح العادي لا يقرأ الرصيد",
    };
  }

  try {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const body = await fetchJson(
      `https://api.openai.com/v1/organization/costs?start_time=${since}&limit=180`, key,
    );
    const buckets = (body.data ?? []) as Array<{ results?: Array<{ amount?: { value?: number } }> }>;
    let used = 0;
    for (const b of buckets) {
      for (const r of b.results ?? []) { used += Number(r.amount?.value ?? 0); }
    }

    return { provider: "openai", remainingUsd: null, grantedUsd: null, usedUsd: used, error: "المتبقّي غير متاح عبر الواجهة" };
  } catch (e) {
    return {
      provider: "openai", remainingUsd: null, grantedUsd: null, usedUsd: null,
      error: e instanceof Error ? e.message : "تعذّر النداء",
    };
  }
}

/**
 * عتبة التنبيه بالدولار.
 *
 * من البيئة لا من جدول: بقية إعدادات التشغيل هنا كذلك، وجدولٌ لإعدادٍ واحد
 * يضيف مكاناً ثانياً يُبحث فيه. تُرفع بتعديل `LLM_BALANCE_ALERT_USD` وإعادة
 * التشغيل حين يكبر الشغل.
 */
export function getLowBalanceThreshold(): number {
  const n = Number(process.env.LLM_BALANCE_ALERT_USD);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function getProviderBalances(): Promise<{
  balances: ProviderBalance[];
  thresholdUsd: number;
  low: ProviderBalance[];
}> {
  const [openrouter, openai] = await Promise.all([getOpenRouterBalance(), getOpenAiBalance()]);
  const thresholdUsd = getLowBalanceThreshold();

  const balances = [openrouter, openai];
  //ما تعذّرت قراءته ليس منخفضاً ولا كافياً — لا يُحسب في الإنذار ويُعرض بسببه
  const low = balances.filter(b => b.remainingUsd !== null && b.remainingUsd <= thresholdUsd);

  return { balances, thresholdUsd, low };
}

// ─── التنبيه ────────────────────────────────────────────────────────────────

//الحالة في ملفّ لا في الذاكرة: النشر يعيد التشغيل فيمسح الذاكرة ويُعاد
//التنبيه — وقعت سبعٌ وثمانون إعادة تشغيل في يوم واحد.

/**
 * ينبّه حين يقارب الرصيد النفاد.
 *
 * **مرّة كل ساعة لكل مزوّد لا مع كل فحص.** إنذارٌ يتكرّر كل دقيقة يُكتَم بعد
 * ثالث مرة، فيصمت حين يجب أن يُسمع. والتنبيه يُرسل ما دام الرصيد منخفضاً —
 * لا مرّة واحدة عند العبور — لأن النفاد يوقف كل مساعِدة في المنتجين.
 *
 * @returns ما أُرسل فعلاً
 */
export async function alertIfLowBalance(): Promise<string[]> {
  const { low, thresholdUsd } = await getProviderBalances();
  if (!low.length) return [];

  const { sendTelegram } = await import("./telegram");
  const { shouldAlert, undoAlert } = await import("./alertState");
  const hourKey = new Date().toISOString().slice(0, 13);
  const sent: string[] = [];

  for (const b of low) {
    const key = `balance:${b.provider}`;
    if (!shouldAlert(key, hourKey)) continue;

    const remaining = (b.remainingUsd ?? 0).toFixed(2);
    const text =
      `⚠️ رصيد ${b.provider} قارب النفاد\n\n` +
      `المتبقّي: $${remaining}\n` +
      (b.grantedUsd !== null ? `المشحون: $${b.grantedUsd.toFixed(2)} · المستهلك: $${(b.usedUsd ?? 0).toFixed(2)}\n` : "") +
      `عتبة التنبيه: $${thresholdUsd.toFixed(2)}\n\n` +
      `عند النفاد تتوقّف سارة وشهد معاً — المفتاح مشترك بينهما.`;

    const r = await sendTelegram(text, { disablePreview: true });
    if (r.ok) { sent.push(b.provider); }
    else { undoAlert(key); console.warn("[providerBalance] تعذّر التنبيه:", r.error); }
  }

  return sent;
}
