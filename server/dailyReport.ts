// ─── تقرير الصباح لصاحب المنصة ───────────────────────────────────────────────
//
// **لماذا تقرير لا تنبيهات فقط:** التنبيهات تقول ما انكسر، ولا تقول كيف تسير
// الأمور. من يقرأ تنبيهاً فقط يعرف مشاكله ولا يعرف نموّه.
//
// **وتاسعةً صباحاً بتوقيت الرياض:** التقرير الذي يصل ليلاً يُقرأ صباحاً وقد
// فقد يومه، والذي يصل مع بداية العمل يُتصرَّف فيه.
//
// **ومرّة واحدة في اليوم لا مرة لكل إعادة تشغيل:** النشر يعيد تشغيل العملية،
// ولو أُرسل عند الإقلاع لوصل عشر مرات في يوم عمل واحد فتوقّف عن قراءته.
import { sql } from "drizzle-orm";
import { getDb } from "./db";

const RIYADH_OFFSET_H = 3;
const HOUR_LOCAL = 9;

export type DailyReport = { text: string; sections: number };

const money = (n: unknown) => Number(n ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 });

/** يبني نصّ التقرير من أرقام مقروءة — لا تقدير ولا صياغة نموذج */
export async function buildDailyReport(): Promise<DailyReport> {
  const db = await getDb();
  if (!db) return { text: "تعذّر الوصول لقاعدة البيانات.", sections: 0 };

  const q = async (s: string) => {
    const [rows] = (await db.execute(sql.raw(s))) as unknown as [Array<Record<string, unknown>>];
    return rows;
  };

  const [reg, subs, revenue, usage, broken, balances] = await Promise.all([
    q("SELECT COUNT(*) n FROM users WHERE createdAt >= CURDATE() - INTERVAL 1 DAY").catch(() => []),
    q(`SELECT COUNT(*) n FROM subscriptions
       WHERE status = 'approved' AND endDate BETWEEN CURDATE() AND CURDATE() + INTERVAL 7 DAY`).catch(() => []),
    q(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments
       WHERE status = 'paid' AND createdAt >= CURDATE() - INTERVAL 1 DAY`).catch(() => []),
    q(`SELECT app, ROUND(SUM(costUsd),4) cost, COUNT(*) calls FROM llm_usage_log
       WHERE createdAt >= CURDATE() - INTERVAL 1 DAY GROUP BY app`).catch(() => []),
    (async () => {
      const { checkErpConnections } = await import("./erpHealth");
      return (await checkErpConnections()).broken;
    })().catch(() => []),
    (async () => {
      const { getProviderBalances } = await import("./providerBalance");
      return getProviderBalances();
    })().catch(() => null),
  ]);

  const lines: string[] = [`☀️ <b>تقرير الصباح</b> — ${new Date().toISOString().slice(0, 10)}`, ""];
  let sections = 0;

  const newUsers = Number(reg[0]?.n ?? 0);
  lines.push(`👤 تسجيلات جديدة أمس: <b>${newUsers}</b>`);
  sections++;

  const paid = revenue[0];
  lines.push(`💰 إيراد أمس: <b>${money(paid?.total)} ريال</b> من ${Number(paid?.n ?? 0)} دفعة`);
  sections++;

  const expiring = Number(subs[0]?.n ?? 0);
  if (expiring > 0) { lines.push(`⏳ اشتراكات تنتهي خلال أسبوع: <b>${expiring}</b>`); sections++; }

  if (usage.length) {
    const parts = usage.map(u => `${u.app} $${Number(u.cost ?? 0).toFixed(4)} (${Number(u.calls ?? 0)} نداء)`);
    lines.push(`🧠 استهلاك النماذج أمس: ${parts.join(" · ")}`);
    sections++;
  }

  if (balances) {
    const b = balances as { balances: Array<{ provider: string; remainingUsd: number | null; error?: string }>; thresholdUsd: number };
    for (const x of b.balances) {
      if (x.remainingUsd === null) continue;
      const low = x.remainingUsd <= b.thresholdUsd;
      lines.push(`${low ? "🔴" : "💳"} رصيد ${x.provider}: <b>$${x.remainingUsd.toFixed(2)}</b>${low ? " — يلزم الشحن" : ""}`);
      sections++;
    }
  }

  // العطل يُذكر بالاسم: «هناك عطل» لا يُتصرَّف فيه، واسمُ العميل يُتصرَّف فيه الآن
  const brokenList = broken as Array<{ email: string; url: string; reason: string }>;
  if (brokenList.length) {
    lines.push("", `🔴 <b>ربط عملاء لا يعمل (${brokenList.length})</b>`);
    for (const b of brokenList.slice(0, 5)) lines.push(`• ${b.email} — ${b.reason}`);
    sections++;
  } else {
    lines.push("✅ كل ربط العملاء يعمل");
  }

  lines.push("", "اكتب لي أي طلب وسأنفّذه.");
  return { text: lines.join("\n"), sections };
}

let lastSentDay = "";

/** يُرسل التقرير مرّة واحدة يومياً في التاسعة صباحاً بتوقيت الرياض */
export async function maybeSendDailyReport(): Promise<{ sent: boolean; reason?: string }> {
  const local = new Date(Date.now() + RIYADH_OFFSET_H * 3600_000);
  const day = local.toISOString().slice(0, 10);
  if (local.getUTCHours() !== HOUR_LOCAL) return { sent: false, reason: "خارج الموعد" };
  if (lastSentDay === day) return { sent: false, reason: "أُرسل اليوم" };

  const { sendTelegram, isTelegramConfigured } = await import("./telegram");
  if (!isTelegramConfigured()) return { sent: false, reason: "تيليجرام غير مضبوط" };

  const report = await buildDailyReport();
  const r = await sendTelegram(report.text, { disablePreview: true });
  //لا يُعلَّم اليوم مُرسَلاً إلا بعد نجاح فعلي: التعليم قبله يُسقط تقرير اليوم كلّه
  if (!r.ok) return { sent: false, reason: r.error ?? "فشل الإرسال" };
  lastSentDay = day;
  return { sent: true };
}
