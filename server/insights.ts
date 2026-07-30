/**
 * تحليلات المنصة للوحة المالك: أعداد العملاء، الاستهلاك، الإيراد مقابل تكلفة
 * النماذج، وهامش الربح — مع نصائح تشغيلية مبنية على أرقام فعلية.
 *
 * النصائح مشتقة بقواعد حسابية صريحة (لا نداء LLM) حتى تكون مجانية وثابتة
 * وقابلة للتفسير: كل نصيحة تذكر الرقم الذي بُنيت عليه.
 */
import { getAllOrgsUsageSummary } from "./credits";
import { getRevenueSummary } from "./revenue";
import { getDb } from "./db";

/** سعر صرف تقريبي لتحويل تكلفة النماذج بالدولار إلى ريال للمقارنة */
const USD_TO_SAR = 3.75;

export type Advice = {
  severity: "critical" | "warning" | "info" | "good";
  title: string;
  detail: string;
};

export async function getPlatformInsights() {
  const [usage, revenue, db] = await Promise.all([
    getAllOrgsUsageSummary(),
    getRevenueSummary(),
    getDb(),
  ]);

  // ─── العملاء ───────────────────────────────────────────────────────────────
  const customers = {
    total: usage.length,
    active: usage.filter(u => u.status === "active").length,
    trial: usage.filter(u => u.status === "trial").length,
    inactive: usage.filter(u => u.status !== "active" && u.status !== "trial").length,
  };

  let totalUsers = 0;
  if (db) {
    const { users } = await import("../drizzle/schema");
    const { sql } = await import("drizzle-orm");
    const r = await db.select({ c: sql<number>`count(*)` }).from(users);
    totalUsers = Number(r[0]?.c ?? 0);
  }

  // ─── الاستهلاك ─────────────────────────────────────────────────────────────
  const totals = usage.reduce((a, u) => ({
    credits: a.credits + u.totalCreditsConsumed,
    tokens: a.tokens + u.totalTokens,
    documents: a.documents + u.totalDocuments,
    messages: a.messages + u.totalMessages,
    calls: a.calls + u.llmCalls,
    costUsd: a.costUsd + u.llmCostUsd,
    balance: a.balance + (u.creditsBalance ?? 0),
  }), { credits: 0, tokens: 0, documents: 0, messages: 0, calls: 0, costUsd: 0, balance: 0 });

  // ─── الربحية ───────────────────────────────────────────────────────────────
  const costSar = totals.costUsd * USD_TO_SAR;
  const netProfitSar = revenue.totalPaidRevenue - costSar;
  const marginPct = revenue.totalPaidRevenue > 0
    ? (netProfitSar / revenue.totalPaidRevenue) * 100
    : 0;
  const costPerCreditSar = totals.credits > 0 ? costSar / totals.credits : 0;
  const avgTokensPerCredit = totals.credits > 0 ? Math.round(totals.tokens / totals.credits) : 0;

  // ─── النصائح ───────────────────────────────────────────────────────────────
  const advice: Advice[] = [];
  const money = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ر.س`;

  if (revenue.totalPaidRevenue === 0 && totals.costUsd > 0) {
    advice.push({
      severity: "critical",
      title: "تكلفة بلا إيراد محصّل",
      detail: `استهلكت النماذج ${money(costSar)} بينما لم يُسجَّل أي دفع فعلي بعد. راجع تفعيل بوابة الدفع وتحويل العملاء التجريبيين إلى مدفوعين.`,
    });
  } else if (marginPct < 50 && revenue.totalPaidRevenue > 0) {
    advice.push({
      severity: "critical",
      title: "هامش الربح منخفض",
      detail: `الهامش ${marginPct.toFixed(1)}% فقط (إيراد ${money(revenue.totalPaidRevenue)} مقابل تكلفة نماذج ${money(costSar)}). راجع تسعير النقطة أو استخدم نموذجاً أرخص للمهام البسيطة.`,
    });
  } else if (revenue.totalPaidRevenue > 0) {
    advice.push({
      severity: "good",
      title: "الربحية سليمة",
      detail: `الهامش ${marginPct.toFixed(1)}% — تكلفة النماذج ${money(costSar)} مقابل إيراد ${money(revenue.totalPaidRevenue)}. التكلفة الحالية لا تشكّل ضغطاً على التسعير.`,
    });
  }

  // تفاوت تكلفة النقطة بين العملاء
  const withUsage = usage.filter(u => u.tokensPerCredit > 0);
  if (withUsage.length >= 2) {
    const sorted = [...withUsage].sort((a, b) => b.tokensPerCredit - a.tokensPerCredit);
    const worst = sorted[0], best = sorted[sorted.length - 1];
    const ratio = best.tokensPerCredit > 0 ? worst.tokensPerCredit / best.tokensPerCredit : 0;
    if (ratio >= 3) {
      advice.push({
        severity: "warning",
        title: "تفاوت كبير في تكلفة النقطة بين العملاء",
        detail: `"${worst.organizationName}" يستهلك ${worst.tokensPerCredit.toLocaleString("en-US")} توكن لكل نقطة مقابل ${best.tokensPerCredit.toLocaleString("en-US")} لدى "${best.organizationName}" (${ratio.toFixed(1)}×). النقطة الواحدة لا تكلّفك نفس المبلغ لكل عميل — فكّر في تسعير حسب التوكنز أو تقليص سياق المحادثات الطويلة.`,
      });
    }
  }

  // عملاء أوشك رصيدهم على النفاد (فرصة بيع)
  const lowBalance = usage.filter(u => (u.creditsBalance ?? 0) > 0 && (u.creditsBalance ?? 0) < 50 && u.status === "active");
  if (lowBalance.length > 0) {
    advice.push({
      severity: "info",
      title: "فرصة بيع: أرصدة على وشك النفاد",
      detail: `${lowBalance.length} عميل نشط رصيدهم أقل من 50 نقطة (${lowBalance.map(u => u.organizationName).join("، ")}). تواصل معهم لشحن رصيد إضافي قبل توقف الخدمة.`,
    });
  }

  // عملاء بلا أي استهلاك (خطر تسرّب)
  const idle = usage.filter(u => u.totalCreditsConsumed === 0 && u.status !== "inactive");
  if (idle.length > 0) {
    advice.push({
      severity: "warning",
      title: "عملاء لم يستخدموا النظام إطلاقاً",
      detail: `${idle.length} عميل لم يستهلك أي نقطة (${idle.map(u => u.organizationName).join("، ")}). هؤلاء الأعلى خطراً لعدم التجديد — تواصل معهم أو اعرض جلسة تعريفية.`,
    });
  }

  // تجريبيون بحاجة متابعة
  if (customers.trial > 0) {
    advice.push({
      severity: "info",
      title: "عملاء في الفترة التجريبية",
      detail: `${customers.trial} عميل في التجربة. تحويلهم قبل انتهاء الفترة هو أسرع مصدر إيراد — تابعهم شخصياً.`,
    });
  }

  // اعتماد على منح إدارية مجانية
  if (revenue.totalAdminGrantsValue > revenue.totalPaidRevenue && revenue.totalAdminGrantsValue > 0) {
    advice.push({
      severity: "warning",
      title: "المنح المجانية تفوق الإيراد المحصّل",
      detail: `قيمة الاشتراكات الممنوحة إدارياً ${money(revenue.totalAdminGrantsValue)} مقابل ${money(revenue.totalPaidRevenue)} محصّلة فعلياً. راجع سياسة المنح أو حوّل بعضها لاشتراكات مدفوعة.`,
    });
  }

  return {
    customers,
    totalUsers,
    usage: {
      totalCredits: totals.credits,
      totalTokens: totals.tokens,
      totalDocuments: totals.documents,
      totalMessages: totals.messages,
      totalCalls: totals.calls,
      remainingBalance: totals.balance,
      avgTokensPerCredit,
    },
    finance: {
      paidRevenueSar: revenue.totalPaidRevenue,
      adminGrantsValueSar: revenue.totalAdminGrantsValue,
      modelCostUsd: Number(totals.costUsd.toFixed(4)),
      modelCostSar: Number(costSar.toFixed(2)),
      netProfitSar: Number(netProfitSar.toFixed(2)),
      marginPct: Number(marginPct.toFixed(1)),
      costPerCreditSar: Number(costPerCreditSar.toFixed(4)),
      byMonth: revenue.byMonth,
    },
    advice,
  };
}
