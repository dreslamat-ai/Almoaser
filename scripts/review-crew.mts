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
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from "fs";
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
  const palette = /\bbg-(blue|violet|emerald|amber|rose|purple|indigo|teal|orange|cyan|pink|lime|sky|fuchsia)-(50|100|500|600)\b/g;
  const offenders: Array<[string, number]> = [];
  for (const p of pages) {
    //المحادثة تستعمل اللون للتمييز بين أنواع المستندات، وهو معنًى لا زينة
    if (/AgentChat|AdminPanel/.test(p)) continue;
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

  return { ok: f.length === 0, findings: f.slice(0, 12) };
}

// ─── التشغيل ────────────────────────────────────────────────────────────────

const CREW: Record<string, () => Promise<Result>> = {
  "مهندس البنية": agentArchitect,
  "المدقّق المالي": agentAuditor,
  "مراقب العملاء": agentCustomers,
  "مهندس التشغيل": agentOps,
  "مدير المنتج": agentProduct,
  "خبير الواجهات": agentUi,
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
  console.log(`  ${name.padEnd(14)} ${r.new!.length ? "✗" : "✓"}  ${String(r.ms).padStart(6)}ms  ${note}`);
  for (const x of r.new!) console.log(`        · ${x}`);
}

if (alerts.length) { console.log(`\n⚠ انحدار جديد عند ${alerts.length} وكيل`); process.exit(1); }
console.log("\n✓ لا انحدار");
process.exit(0);
