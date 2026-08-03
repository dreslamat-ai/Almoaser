/**
 * فريق مراجعة منصة المعاصر AI.
 *
 * ## لماذا وُجد
 * كان لـAlmoaserPos فريقُ مراجعة يعمل كل أربع ساعات، ولم يكن لهذه المنصة شيء.
 * فبُني هنا اليوم مساعدٌ إداري ولوحة استهلاك وتقرير صباح وفحص اتصالات وأيقونة
 * ولمبات — **ولم يفحصها وكيل واحد**. حماها المترجم والاختبارات، وهما يمسكان
 * الأنواع لا السلوك.
 *
 * ## وما يقيسه كلٌّ منهم
 * لكل وكيل سؤالٌ لا يسأله غيره، وكلٌّ يقيس شيئاً وقع فعلاً — لا احتياطاً نظرياً.
 *
 * ## والانحدار وحده يُصرَّح به
 * خطّ أساس في `review-crew-baseline.json`. «كل شيء بخير» كل أربع ساعات يُقرأ
 * مرّة ويُهمَل بعدها.
 *
 *   npx tsx scripts/review-crew.mts            تقرير كامل
 *   npx tsx scripts/review-crew.mts --quiet    لا يطبع إلا عند الانحدار
 *   npx tsx scripts/review-crew.mts --accept   يعتمد الحال الراهن أساساً
 *   npx tsx scripts/review-crew.mts --only=نص  وكيل واحد
 */
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync, lstatSync, realpathSync, accessSync, constants } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts", "review-crew-baseline.json");
const LOG = "/home/eipsys/review-crew-ai.jsonl";

type Result = { ok: boolean; findings: string[]; note?: string; ms?: number; new?: string[]; known?: number };

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));

/** كل ملفات المصدر — للفحوص البنيوية */
function sources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, f);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (!/node_modules|dist|\.git/.test(f)) sources(rel, out); }
    else if (/\.(ts|tsx|mts)$/.test(f) && !/\.test\./.test(f)) out.push(rel);
  }
  return out;
}

// ─── الوكلاء ────────────────────────────────────────────────────────────────

/**
 * مهندس البنية — الثوابت التي إن سقطت سقط ما بُني عليها، وسقوطها صامت.
 */
async function agentArchitect(): Promise<Result> {
  const f: string[] = [];

  // ١) حواجز وكيل الإدارة: ينفّذ على بيانات عملاء حقيقيين
  if (exists("server/adminAgent.ts")) {
    const src = read("server/adminAgent.ts");
    const names = Array.from(src.matchAll(/name: "([a-z_]+)"/g)).map(m => m[1]);
    for (const n of names) {
      if (/delete|remove|destroy|drop|purge|truncate/.test(n)) f.push(`وكيل الإدارة يملك أداة حذف: ${n}`);
    }
    if (src.includes("create_invoice")) f.push("وكيل الإدارة يُنشئ فواتير عملاء — ذلك عمل وكيل آخر");
    if (!src.includes("createCaller") && !src.includes("caller")) f.push("وكيل الإدارة لا يمرّ بالمستدعي — قد يلتفّ على الصلاحيات");
  } else {
    f.push("server/adminAgent.ts مفقود");
  }

  // ٢) الفصل المالي: تكلفة شهد لا تُحمَّل على هامش هذه المنصة
  if (exists("server/llmUsage.ts")) {
    const src = read("server/llmUsage.ts");
    if (!src.includes("BILLED_APPS")) f.push("سقط فصل التطبيقات المحسوبة — تكلفة شهد ستعود إلى هامش المنصة");
    if (!/getLlmCostSummary\([^)]*apps/.test(src)) f.push("getLlmCostSummary لا يقبل ترشيح التطبيقات");
  }

  // ٣) نقطة تبليغ الاستهلاك لا تُفتح بلا سرّ
  if (exists("server/llmUsageIngest.ts")) {
    const src = read("server/llmUsageIngest.ts");
    if (!src.includes("timingSafeEqual")) f.push("مقارنة سرّ التبليغ ليست ثابتة الزمن");
    if (!src.includes("LLM_USAGE_INGEST_SECRET")) f.push("نقطة التبليغ بلا سرّ مطلوب");
  }

  // ٤) لا مفتاح ولا سرّ متتبَّع في git
  const tracked = read(".gitignore");
  if (!/^\.env$/m.test(tracked) && !/(^|\n)\.env/.test(tracked)) f.push(".env غير مستثنى في .gitignore");

  // ٥) لا سرّ مكتوب في المصدر
  for (const p of sources("server")) {
    const src = read(p);
    if (/sk-[A-Za-z0-9]{20,}|(?:password|secret)\s*=\s*["'][^"']{8,}["']/.test(src)
        && !/process\.env/.test(src.slice(Math.max(0, src.search(/sk-|password\s*=|secret\s*=/)) - 120, src.search(/sk-|password\s*=|secret\s*=/) + 120))) {
      f.push(`سرٌّ محتمل مكتوب في المصدر: ${p}`);
    }
  }

  return { ok: f.length === 0, findings: f.slice(0, 10) };
}

/**
 * المدقّق المالي — الأرقام المعروضة تقيس ما تدّعي قياسه.
 */
async function agentAuditor(): Promise<Result> {
  const f: string[] = [];
  const db = await getDb();
  if (!db) return { ok: true, findings: [], note: "لا قاعدة" };

  const q = async (s: string) => {
    const [rows] = (await db.execute(sql.raw(s))) as unknown as [Array<Record<string, unknown>>];
    return rows;
  };

  // الاستهلاك موزّع، وما ليس sara يجب أن يبقى خارج المقارنة
  const apps = await q("SELECT app, ROUND(SUM(costUsd),4) c FROM llm_usage_log GROUP BY app");
  const unbilled = apps.filter(a => a.app !== "sara");
  if (unbilled.length) {
    const src = exists("server/llmUsage.ts") ? read("server/llmUsage.ts") : "";
    if (!src.includes('BILLED_APPS = ["sara"]')) {
      f.push(`تطبيقات خارج sara تُنفق (${unbilled.map(u => u.app).join("، ")}) وقائمة المحسوبين تغيّرت`);
    }
  }

  // كل استهلاك له تطبيق: صفٌّ بلا نسبة يضيع من كل تقرير
  const orphan = await q("SELECT COUNT(*) n FROM llm_usage_log WHERE app IS NULL OR app = ''");
  if (Number(orphan[0]?.n ?? 0) > 0) f.push(`${orphan[0].n} صف استهلاك بلا تطبيق`);

  // تكلفة سالبة أو توكنز سالبة: خطأ حساب لا واقع
  const bad = await q("SELECT COUNT(*) n FROM llm_usage_log WHERE costUsd < 0 OR totalTokens < 0");
  if (Number(bad[0]?.n ?? 0) > 0) f.push(`${bad[0].n} صف استهلاك بقيم سالبة`);

  return { ok: f.length === 0, findings: f };
}

/**
 * مراقب العملاء — حال من يدفع لنا الآن.
 */
async function agentCustomers(): Promise<Result> {
  const f: string[] = [];
  const { checkErpConnections } = await import("../server/erpHealth");
  const { ok, broken } = await checkErpConnections();
  for (const b of broken) f.push(`ربط ${b.email} لا يعمل — ${b.reason}`);
  return { ok: f.length === 0, findings: f, note: `سليم ${ok} · معطوب ${broken.length}` };
}

/**
 * مهندس التشغيل — ما يجب أن يعمل تلقائياً موصولٌ فعلاً.
 *
 * دالةٌ تُكتب ولا يناديها أحد لا تعمل — وقع ذلك فعلاً مع تنبيه الرصيد.
 */
async function agentOps(): Promise<Result> {
  const f: string[] = [];
  if (!exists("server/scheduler.ts")) return { ok: false, findings: ["scheduler.ts مفقود"] };
  const sched = read("server/scheduler.ts");

  const wired: Array<[string, string]> = [
    ["alertIfLowBalance", "تنبيه الرصيد"],
    ["checkErpConnections", "فحص اتصالات العملاء"],
    ["maybeSendDailyReport", "تقرير الصباح"],
    ["getUnbilledApps", "تنبيه تطبيق غير محسوب"],
    ["sendLeadDigest", "تذكير العملاء المحتملين"],
  ];
  for (const [fn, label] of wired) {
    if (!sched.includes(fn)) f.push(`${label} غير موصول بالجدولة (${fn})`);
  }

  // كل مؤقّت داخلي له بداية: دالةٌ تُكتب ولا يناديها أحد لا تعمل.
  //
  // **والمُصدَّرة تُستثنى:** `startScheduledJobs` نقطةُ الدخول، يناديها
  // `_core/index.ts` لا هذا الملف. عدّها أوقع الوكيل في إنذار كاذب أول تشغيلة —
  // ومقياسٌ يصرخ على سليم يُفقد الثقة في صراخه كلّه.
  const internal = (sched.match(/\nfunction start[A-Za-z]+\(/g) ?? []).length;
  const called = (sched.match(/\n\s+start[A-Za-z]+\(\);/g) ?? []).length;
  if (internal > called) f.push(`${internal - called} مهمة دورية معرّفة ولا تُستدعى`);

  return { ok: f.length === 0, findings: f, note: `${wired.length} مهمة مفحوصة` };
}

/**
 * مدير المنتج — ما يراه العميل يقول الحقيقة عن حاله.
 */
async function agentProduct(): Promise<Result> {
  const f: string[] = [];

  // حالة الربط تُقاس لا تُقرأ من حقل قديم
  if (exists("client/src/components/ConnectionStatus.tsx")) {
    const src = read("client/src/components/ConnectionStatus.tsx");
    if (!src.includes("erpConnection.status")) f.push("لمبة الاتصال لا تسأل عن الحالة الحيّة");
    if (/dismiss|إغلاق الشريط/.test(src.split("ConnectionBanner")[1] ?? "")) {
      f.push("شريط الانقطاع صار قابلاً للإغلاق — يُغلَق ويُنسى والعميل يظلّ معطّلاً");
    }
  } else {
    f.push("مكوّن حالة الاتصال مفقود");
  }

  // الشريط في التخطيط لا في صفحة واحدة
  if (exists("client/src/components/DashboardLayout.tsx")) {
    const src = read("client/src/components/DashboardLayout.tsx");
    if (!src.includes("ConnectionBanner")) f.push("شريط الانقطاع غير مركّب في التخطيط");
    if (!src.includes("ConnectionLamp")) f.push("لمبة الاتصال غير ظاهرة في القائمة");
    //«وكيل AI» مصطلحٌ من جانبنا لا من جانب صاحب المحل
    if (/وكيل AI|وكيل الذكاء الاصطناعي/.test(src)) f.push("لا يزال يُسمّى «وكيل AI» بدل «المحاسب الذكي»");
  }

  // النموذج لا يدهس ما كتبه المستخدم عند عودة النافذة
  if (exists("client/src/pages/AccountSettings.tsx")) {
    const src = read("client/src/pages/AccountSettings.tsx");
    if (!src.includes("companyHydrated")) {
      f.push("نموذج بيانات الشركة قد يدهس ما كتبه المستخدم عند إعادة الجلب");
    }
  }

  // الاسم القديم في أي شاشة
  for (const p of sources("client/src")) {
    if (/وكيل AI\b/.test(read(p))) f.push(`اسم قديم «وكيل AI» في ${p}`);
  }

  return { ok: f.length === 0, findings: f.slice(0, 10) };
}


/**
 * خبير الواجهات — ما يراه المستخدم ويلمسه، لا ما يعمل فقط.
 *
 * **لماذا وكيلٌ له وحده:** مهندس البنية يسأل «هل الثابت قائم؟» ومدير المنتج
 * «هل الرحلة تكتمل؟» — ولا أحد يسأل «هل يبدو من منتجٍ واحد؟». والواجهة تنحدر
 * بالتراكم لا بعطلٍ واحد: لونٌ يُضاف هنا وحافةٌ مختلفة هناك، حتى تبدو كل شاشة
 * من يدٍ أخرى.
 */
async function agentUi(): Promise<Result> {
  const f: string[] = [];
  const pages = sources("client/src");

  // ١) اللون معنى لا زينة: ألوان تيلويند العشوائية للأسطح
  // **الأخضر والكهرماني والأحمر والأزرق حالاتٌ لا زينة** — مدفوع، معلّق،
  // خطأ، معلومة. تُقاس الألوان التي لا تصف حالة: البنفسجي والفيروزي
  // والنيلي وأخواتها زينةٌ بحتة، وهي التي تجعل الشاشة تبدو من قوالب.
  //
  // أول صيغة عدّت الجميع فبلّغت عن أربعين لوناً في شاشة الدردشة، وأكثرها
  // دلالي — ومقياسٌ يعدّ الصواب خطأً يُدفن بلاغه كلّه.
  const palette = /\bbg-(violet|purple|indigo|teal|cyan|pink|lime|fuchsia|sky|orange)-(50|100|500|600)\b/g;
  const offenders: Array<[string, number]> = [];
  for (const p of pages) {
    //**لا استثناء للمحادثة بعد اليوم.** كانت مستثناة بحجّة أن اللون فيها
    //يميّز أنواع المستندات — وهو صحيح لبضعة ألوان لا لثمانية وثلاثين.
    //الاستثناء الذي يُمنح مرّة يُخفي انحداراً كاملاً: شاشة الدردشة أكبر
    //شاشة في المنتج وأكثرها استعمالاً، وهي آخر ما راجعه أحد.
    if (/AdminPanel/.test(p)) continue;
    const n = (read(p).match(palette) ?? []).length;
    if (n >= 4) offenders.push([p, n]);
  }
  for (const [p, n] of offenders.sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    f.push(`${n} لوناً عشوائياً في ${p} — اللون يجب أن يصف الحالة لا يزيّنها`);
  }

  // ٢) طبقة الهوية قائمة
  const css = read("client/src/index.css");
  for (const cls of ["m-card", "m-icon", "m-stat", "m-title"]) {
    if (!css.includes(`.${cls}`)) f.push(`صنف الهوية .${cls} سقط من index.css`);
  }
  if (!css.includes("focus-visible")) f.push("حلقة التركيز سقطت — من يتنقّل بالكيبورد لا يرى أين هو");
  if (!/min-height: 2\.75rem/.test(css)) f.push("هدف اللمس ٤٤ بكسل سقط من الأنماط");

  // ٣) قشرةٌ واحدة وقائمةٌ واحدة
  const shells = pages.filter(p => /pages\//.test(p) && /min-h-screen bg-gray-50/.test(read(p)) && /Sidebar/.test(read(p)));
  for (const p of shells) f.push(`قِشرة ثانية بقائمة خاصة في ${p}`);

  // ٤) لا صورة بلا بديل نصّي — من يقرأ بقارئ شاشة لا يرى شيئاً
  for (const p of pages) {
    const src = read(p);
    for (const m of src.matchAll(/<img\s[^>]*>/g)) {
      if (!/\balt=/.test(m[0])) { f.push(`صورة بلا alt في ${p}`); break; }
    }
  }

  // ٥) زرٌّ بأيقونة وحدها يحتاج اسماً يُنطق
  for (const p of pages) {
    const src = read(p);
    const bad = Array.from(src.matchAll(/<button(?![^>]*aria-label)[^>]*>\s*<[A-Z][A-Za-z]*\s[^>]*\/>\s*<\/button>/g)).length;
    if (bad >= 2) f.push(`${bad} زرّ بأيقونة بلا aria-label في ${p}`);
  }


  // ٦) الشاشة الأكثر استعمالاً تُفحص وحدها: طولها يجعل الانحدار فيها يمرّ
  if (exists("client/src/pages/AgentChat.tsx")) {
    const chat = read("client/src/pages/AgentChat.tsx");
    if (!/m-card|m-icon|m-stat/.test(chat)) f.push("شاشة الدردشة لا تستعمل طبقة الهوية إطلاقاً");
    //ترويسة التخطيط تسمّي الشاشة وتعرض اللمبة؛ تكرارهما ازدحامٌ لا معلومة
    if (/المعاصر AI — المحاسب الذكي/.test(chat)) f.push("شاشة الدردشة تكرّر اسم الصفحة الموجود في الترويسة");
    if (/>\s*متصل\s*</.test(chat)) f.push("شاشة الدردشة تكرّر حالة الاتصال الموجودة في الترويسة");
  }

  // ٧) التوسيط على الجوال — الشاشة الضيّقة تجعل المحاذاة لليمين تبدو معلّقة
  if (!/max-width: 767px/.test(css) || !/text-align: center/.test(css)) {
    f.push("قواعد التوسيط على الجوال سقطت من index.css");
  }

  // ٨) لا نصّ أصغر من 11px — يُقرأ بالعدسة لا بالعين.
  //
  // **ويُستثنى ما أُعلن رسماً.** صفحة البداية فيها هاتف مرسوم بداخله فاتورة
  // مصغّرة: نصّها صغير عمداً لأنه صورة لواجهة لا واجهة، وتكبيره يُفسد الرسم.
  // إنذارٌ يصرخ على شيء سليم يُعلّم تجاهلَ صراخه كلّه — فالمقياس يتخطّى ما
  // بين ui-agent:mockup-start و mockup-end، والاستثناء مكتوب في الشيفرة لا
  // في رأس المراجع.
  for (const p of pages) {
    const src = read(p).replace(/ui-agent:mockup-start[\s\S]*?ui-agent:mockup-end/g, "");
    const tiny = Array.from(src.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g))
      .map(m => Number(m[1])).filter(n => n < 11);
    if (tiny.length) f.push(`${tiny.length} نصّ أصغر من 11px في ${p}`);
  }

  // ٩) لا لون مكتوب بالسداسي مبعثراً في المكوّنات — الهوية في المتغيّرات.
  //
  // **ويُستثنى لونان لا يُنسبان إلينا:** لونٌ مُسمّى في ثابت أعلى الملف
  // (`const X = "#..."`) — وهو الشكل الصحيح لأن recharts يرسم على SVG ولا
  // يقبل أصناف Tailwind، فجمعُها في أسماء يجعل التغيير في موضع واحد؛ ولون
  // علامة تجارية لخدمة خارجية (واتساب، تليجرام) — ليس لنا أن نغيّره.
  const BRAND_HEX = /#(25D366|0088cc|1DA1F2|4267B2)\b/i;
  for (const p of pages) {
    if (!/pages\/|components\//.test(p)) continue;
    // الرسم المُعلن يُتخطّى هنا كذلك: ألوان هاتف تليجرام المرسوم في صفحة
    // البداية هي ألوان تليجرام، ليست هويّتنا ولا يصحّ ربطها بمتغيّراتها.
    const src = read(p).replace(/ui-agent:mockup-start[\s\S]*?ui-agent:mockup-end/g, "");
    const loose = (src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter(h => !BRAND_HEX.test(h)).length;
    const named = (src.match(/^const [A-Z_0-9]+ = "#[0-9a-fA-F]{6}"/gm) ?? []).length;
    if (loose - named >= 3) {
      f.push(`${loose - named} لوناً سداسياً مبعثراً في ${p} — اجمعها في ثوابت مسمّاة`);
    }
  }

  // ١٠) كل حقل إدخال له عنوان منطوق — النموذج بلا تسمية لا يُملأ بقارئ شاشة
  for (const p of pages) {
    const src = read(p);
    const bare = Array.from(src.matchAll(/<Input(?![A-Za-z])(?![^>]*(?:aria-label|id=|placeholder))[^>]*\/>/g)).length;
    if (bare >= 3) f.push(`${bare} حقل إدخال بلا تسمية في ${p}`);
  }

  // ١١) الحركة تحترم من يطلب تقليلها — الدوّار الدائم يُدوّخ بعض الناس
  if (!/prefers-reduced-motion/.test(css)) {
    f.push("لا احترام لـprefers-reduced-motion — الحركة الدائمة تُتعب من يطلب تقليلها");
  }


  // ١٢) ألوان زخرفية خارج الهوية — بأسماء لوحة Tailwind لا بالسداسي.
  //
  // فحص السداسي أعلاه لا يراها إطلاقاً: `text-violet-600` صنفٌ لا لون مكتوب،
  // فمرّ بنفسجيٌّ في شاشة المحادثة أشهراً في هويةٍ كحلية وذهبية. والدلالية
  // مستثناة: الأخضر نجاح، والأحمر خطأ، والكهرماني تحذير — وظيفةٌ لا زينة.
  const OFF_PALETTE = /\b(?:text|bg|border|ring|from|to|via)-(violet|purple|indigo|fuchsia|pink|sky|cyan|lime|orange)-[0-9]{2,3}\b/g;
  for (const p of pages) {
    const src = read(p).replace(/ui-agent:mockup-start[\s\S]*?ui-agent:mockup-end/g, "");
    const hits = Array.from(src.matchAll(OFF_PALETTE)).map(m => m[1]);
    if (hits.length) {
      f.push(`${hits.length} لوناً خارج الهوية في ${p} (${[...new Set(hits)].join("، ")})`);
    }
  }

  // ١٣) هدف اللمس ٤٤ بكسل — ما دونه يُخطئه الإصبع فيضغط جاره.
  //
  // القاعدة مكتوبة في نظام العمل ولم يكن يقيسها أحد: رُفعت الأهداف يدوياً
  // في commit ثم أُنقصت في تصميمٍ لاحق بلا أن ينبّه شيء. الشرط هنا: كل زرّ
  // بارتفاع أقلّ من h-11 يجب أن يحمل استثناء المؤشّر الخشن معه.
  for (const p of pages) {
    const src = read(p).replace(/ui-agent:mockup-start[\s\S]*?ui-agent:mockup-end/g, "");
    let small = 0;
    for (const m of src.matchAll(/<button[^>]*className=\{?["`][^"`]*\bh-(\d+(?:\.\d+)?)\b[^"`]*["`]/g)) {
      const h = Number(m[1]);
      if (h < 11 && !/pointer:coarse/.test(m[0])) small++;
    }
    if (small >= 3) f.push(`${small} زرّاً دون ٤٤ بكسل بلا استثناء للمس في ${p}`);
  }

  return { ok: f.length === 0, findings: f.slice(0, 12) };
}

/**
 * مهندس البنية التحتية (DevOps) — الآلة التي يعمل عليها كل ما سبق.
 *
 * بقيةُ الفريق تقرأ الشيفرة. وهذا يقرأ **الخادم**: هل النسخة الاحتياطية
 * حديثة وخارج هذه الآلة، وهل الشهادة قاربت، وهل بقي قرص، وهل ما يعمل الآن
 * هو ما في المستودع، وهل انكشف في جذر الويب ما لا يُنشر.
 *
 * كل بندٍ هنا وقع فعلاً في أحد المشروعين، لا احتياطاً نظرياً:
 * ملفٌّ مضغوط فيه `.env` كان يُنزَّل من الإنترنت، ورفعُ النسخ الخارجي يفشل
 * منذ أيام وهو مكتوبٌ في سجلٍّ لا يقرؤه أحد، وحالةُ التشغيل كانت تُكتب في
 * مسارٍ لا يملك التطبيق الكتابة فيه فتفشل بصمت.
 */
async function agentDevops(): Promise<Result> {
  const f: string[] = [];
  const sh = (cmd: string): string => {
    try { return execSync(cmd, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return ""; }
  };
  const HOURS = 3600_000;
  let checked = 0;

  // ١) نسخة احتياطية حديثة. النسخُ الذي يتوقّف لا يُعلن عن نفسه — يُكتشف
  //    يوم يُحتاج إليه، وذلك أسوأ يوم لاكتشافه.
  const backupDir = process.env.BACKUP_DIR ?? "/home/eipsys/backups/almoaser";
  checked++;
  if (!existsSync(backupDir)) {
    f.push(`مجلّد النسخ ${backupDir} غير موجود`);
  } else {
    const dumps = readdirSync(backupDir).filter(n => n.endsWith(".sql.gz"));
    if (!dumps.length) f.push("لا نسخة قاعدة بيانات واحدة في مجلّد النسخ");
    else {
      const newest = Math.max(...dumps.map(n => statSync(join(backupDir, n)).mtimeMs));
      const ageH = (Date.now() - newest) / HOURS;
      // النسخ يومي الساعة ٣:٢٠ — فستّ وثلاثون ساعة تعني أن ليلةً سقطت
      if (ageH > 36) f.push(`أحدث نسخة احتياطية عمرها ${Math.round(ageH)} ساعة — النسخ اليومي متوقّف`);
      const tiny = dumps.filter(n => statSync(join(backupDir, n)).size < 10 * 1024).length;
      if (tiny) f.push(`${tiny} نسخة أصغر من 10ك — نسخةٌ فارغة تُطمئن ولا تُستعاد`);
    }
    // ٢) نسخةٌ على الآلة نفسها ليست نسخة: من فقد الخادم فقدها معه.
    checked++;
    const log = join(backupDir, "backup.log");
    if (existsSync(log)) {
      const tail = readFileSync(log, "utf8").split("\n").slice(-40).join("\n");
      if (/تعذّر الرفع الخارجي/.test(tail)) f.push("الرفع الخارجي للنسخ يفشل — النسخ كلّها على الخادم نفسه");
    }
  }

  // ٣) الشهادة. انتهاؤها يُسقط الموقع كلَّه دفعةً واحدة، والتجديد التلقائي
  //    قد يتعطّل بصمت — فيُنظر إلى ما تقوله الشهادة الحيّة لا إلى الإعداد.
  checked++;
  const host = process.env.PUBLIC_HOST ?? "erpsys.cloud";
  const notAfter = sh(`echo | openssl s_client -connect ${host}:443 -servername ${host} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2`);
  if (notAfter) {
    const days = (new Date(notAfter).getTime() - Date.now()) / (24 * HOURS);
    if (days < 21) f.push(`شهادة ${host} تنتهي بعد ${Math.round(days)} يوماً — التجديد التلقائي لم يعمل`);
  } else {
    f.push(`تعذّرت قراءة شهادة ${host}`);
  }

  // ٤) القرص. الامتلاء يوقف الكتابة في القاعدة والسجلّات معاً، ويبدأ عادةً
  //    من سجلٍّ ينمو بلا تدوير.
  checked++;
  const usedPct = Number(sh("df --output=pcent / | tail -1").replace(/[^0-9]/g, ""));
  if (usedPct >= 85) f.push(`القرص ممتلئ ${usedPct}٪`);

  // ٥) ما يعمل الآن هو ما في المستودع. تعديلٌ يدوي على الإنتاج يضيع بأوّل
  //    نشر، أو أسوأ: يبقى ولا يعرف أحد أنه هناك.
  checked++;
  const dirty = sh("git -C . status --porcelain 2>/dev/null | grep -v '^??' | head -20");
  if (dirty) f.push(`${dirty.split("\n").length} ملفاً معدَّلاً وغير مُودَع على الإنتاج`);
  const branch = sh("git -C . rev-parse --abbrev-ref HEAD 2>/dev/null");
  if (branch && branch !== "main") f.push(`الإنتاج على فرع ${branch} لا main`);

  // ٦) التراجع ممكن: رابطٌ حيّ يشير إلى إصدارٍ موجود، وإصداراتٌ محفوظة.
  checked++;
  const live = join(ROOT, "dist", "public");
  if (existsSync(live)) {
    try {
      if (lstatSync(live).isSymbolicLink() && !existsSync(realpathSync(live))) {
        f.push("dist/public يشير إلى إصدار محذوف — الموقع يخدم من العدم");
      }
    } catch { f.push("dist/public رابطٌ مكسور"); }
  }
  const rel = join(ROOT, "dist", "releases");
  if (existsSync(rel) && readdirSync(rel).length < 2) f.push("إصدار واحد محفوظ — لا تراجع فوري عند فشل نشر");

  // ٧) ما لا يُنشر لا يكون في جذر النشر. ملفٌّ مضغوط للموقع كاملاً وفيه
  //    `.env` كان قابلاً للتنزيل من الإنترنت في المشروع الآخر.
  checked++;
  if (existsSync(live)) {
    try {
      const leaked = readdirSync(realpathSync(live))
        .filter(n => /\.(env|sql|zip|tar|gz|bak|pem|key)$/i.test(n) || n === ".env" || n === ".git");
      if (leaked.length) f.push(`مكشوف في جذر النشر: ${leaked.slice(0, 5).join("، ")}`);
    } catch { /* الرابط مكسور — أُبلغ عنه أعلاه */ }
  }

  // ٨) صلاحيات الأسرار: `.env` فيه كلمة قاعدة البيانات ومفاتيح المزوّدين.
  checked++;
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const mode = statSync(envPath).mode & 0o777;
    if (mode & 0o004) f.push(`.env مقروء للجميع (${mode.toString(8)})`);
  } else {
    f.push(".env مفقود — التطبيق يعمل بإعدادات ناقصة");
  }

  // ٩) حالة التشغيل قابلة للكتابة. كانت في بيت مستخدمٍ آخر فظلّت كل كتابة
  //    تفشل بصمت، وبقي تكرار التنبيهات الذي «أُصلح» قائماً.
  checked++;
  const stateDir = process.env.STATE_DIR ?? join(ROOT, ".runtime-state");
  try { accessSync(stateDir, constants.W_OK); }
  catch { f.push(`مجلّد الحالة ${stateDir} غير قابل للكتابة — التنبيهات تتكرّر والتذكيرات تضيع`); }

  // ١٠) المهامّ المجدولة موجودة فعلاً في cron لا في النيّة وحدها.
  checked++;
  const cron = sh("crontab -l 2>/dev/null");
  if (cron) {
    if (!/backup-db\.sh/.test(cron)) f.push("النسخ الاحتياطي غير مجدول في cron");
    if (!/review-crew-ai/.test(cron)) f.push("فريق المراجعة غير مجدول في cron");
  }

  // ١١) هل التطبيق حيّ؟
  //
  // **لا يُسأل pm2 مباشرةً.** الفريق يعمل بمستخدم غير الذي يشغّل التطبيق،
  // ولكلّ مستخدمٍ عفريتُ pm2 خاصّ به — فـ`pm2 jlist` هنا يعرض قائمةً أخرى
  // لا يظهر فيها التطبيق، فأنذر أوّل تشغيلة بأن العملية «غير موجودة» وهي
  // تعمل منذ أربع وأربعين دقيقة. مقياسٌ يصرخ على سليم يُفقد الثقة في صراخه.
  //
  // فيُسأل ما يهمّ فعلاً: هل يردّ الموقع؟ وهل يقول جدولُ صاحبه إنه online؟
  checked++;
  const code = sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 12 https://${host}/`);
  if (code && !/^(2|3)/.test(code)) f.push(`${host} يردّ ${code}`);
  else if (!code) f.push(`${host} لا يردّ إطلاقاً`);

  checked++;
  const list = sh("timeout 25 almoaser list 2>/dev/null | grep almoaser-ai");
  // الغياب هنا لا يعني التعطّل: قد لا يملك المُشغِّل هذا الأمر أصلاً
  if (list && !/online/.test(list)) f.push("جدول pm2 لا يقول إن almoaser-ai online");

  // ١٢) لا سرّ مكتوب في الشيفرة. المفتاح في ملفٍّ يُدار، وفي الشيفرة يُنشر.
  checked++;
  const SECRET = /(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  for (const src of sources("server").concat(sources("client/src")).concat(sources("scripts"))) {
    if (SECRET.test(read(src))) f.push(`سرٌّ مكتوب في الشيفرة: ${src}`);
  }

  return { ok: f.length === 0, findings: f.slice(0, 12), note: `${checked} فحصاً للبنية` };
}

// ─── التشغيل ────────────────────────────────────────────────────────────────

const CREW: Record<string, () => Promise<Result>> = {
  "مهندس البنية": agentArchitect,
  "المدقّق المالي": agentAuditor,
  "مراقب العملاء": agentCustomers,
  "مهندس التشغيل": agentOps,
  "مدير المنتج": agentProduct,
  "خبير الواجهات": agentUi,
  "مهندس البنية التحتية": agentDevops,
};

const quiet = process.argv.includes("--quiet");
const accept = process.argv.includes("--accept");
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7);

const run: Record<string, Result> = {};
for (const [name, fn] of Object.entries(CREW)) {
  if (only && !name.includes(only)) continue;
  const t0 = Date.now();
  try {
    run[name] = await fn();
  } catch (e) {
    run[name] = { ok: false, findings: [`الوكيل تعثّر: ${e instanceof Error ? e.message.slice(0, 140) : "خطأ"}`] };
  }
  run[name].ms = Date.now() - t0;
}

const baseline: Record<string, string[]> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};

const alerts: string[] = [];
const fresh: Record<string, string[]> = {};
for (const [name, r] of Object.entries(run)) {
  const known = baseline[name] ?? [];
  r.new = r.findings.filter(x => !known.includes(x));
  r.known = r.findings.length - r.new.length;
  fresh[name] = r.findings;
  if (r.new.length) alerts.push(`${name}: ${r.new.slice(0, 3).join(" | ")}`);
}

if (accept) {
  writeFileSync(BASELINE, JSON.stringify(fresh, null, 2));
  console.log("✓ اعتُمد الحال الراهن خطَّ أساس");
}

try { appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), agents: run, alerts }) + "\n"); } catch { /* السجل ليس شرطاً */ }

if (quiet && !alerts.length) process.exit(0);

console.log(`\nفريق مراجعة المعاصر AI — ${new Date().toLocaleString("ar-EG")}\n`);
for (const [name, r] of Object.entries(run)) {
  const note = [r.note, r.known ? `(${r.known} معروف)` : ""].filter(Boolean).join("  ");
  console.log(`  ${name.padEnd(18)} ${r.new!.length ? "✗" : "✓"}  ${String(r.ms).padStart(6)}ms  ${note}`);
  for (const x of r.new!) console.log(`        · ${x}`);
}

if (alerts.length) { console.log(`\n⚠ انحدار جديد عند ${alerts.length} وكيل`); process.exit(1); }
console.log("\n✓ لا انحدار");
process.exit(0);
