// ─── ملخص الإيرادات: التحصيل الفعلي مقابل قيمة المنح الإدارية المجانية ────────
import { sql, desc, eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { payments } from "../drizzle/schema";

// سعر صرف ثابت (ربط الريال بالدولار منذ 1986) — لتحويل تكلفة النماذج بالدولار
// إلى ريال لمقارنتها بالإيرادات، والعكس عند الحاجة
export const SAR_PER_USD = 3.75;

/** إجمالي الإيرادات الفعلية المحصّلة (ريال) مقابل قيمة المنح الإدارية المجانية */
export async function getRevenueSummary() {
  const db = await getDb();
  if (!db) {
    return { totalPaidRevenue: 0, totalAdminGrantsValue: 0, byMonth: [] as Array<{ month: string; paidRevenue: number; grantsValue: number }> };
  }

  const [paidRows, grantsRows, monthlyRows] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "paid"), eq(payments.grantedByAdmin, false))),
    db
      .select({ total: sql<string>`coalesce(sum(${payments.equivalentValue}), 0)` })
      .from(payments)
      .where(eq(payments.grantedByAdmin, true)),
    db
      .select({
        month: sql<string>`date_format(${payments.createdAt}, '%Y-%m')`,
        paidRevenue: sql<string>`coalesce(sum(case when ${payments.grantedByAdmin} = false and ${payments.status} = 'paid' then ${payments.amount} else 0 end), 0)`,
        grantsValue: sql<string>`coalesce(sum(case when ${payments.grantedByAdmin} = true then ${payments.equivalentValue} else 0 end), 0)`,
      })
      .from(payments)
      .groupBy(sql`date_format(${payments.createdAt}, '%Y-%m')`)
      .orderBy(desc(sql`date_format(${payments.createdAt}, '%Y-%m')`))
      .limit(12),
  ]);

  return {
    totalPaidRevenue: Number(paidRows[0]?.total ?? 0),
    totalAdminGrantsValue: Number(grantsRows[0]?.total ?? 0),
    byMonth: monthlyRows.map(r => ({
      month: r.month,
      paidRevenue: Number(r.paidRevenue),
      grantsValue: Number(r.grantsValue),
    })),
  };
}

/** تصدير سجل مالي كامل (CSV) لكل المدفوعات والمنح الإدارية */
export async function exportFinancialReportCsv(): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  const { users } = await import("../drizzle/schema");
  const rows = await db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      ownerName: users.name,
      ownerEmail: users.email,
      purpose: payments.purpose,
      billing: payments.billing,
      credits: payments.credits,
      amount: payments.amount,
      currency: payments.currency,
      status: payments.status,
      grantedByAdmin: payments.grantedByAdmin,
      equivalentValue: payments.equivalentValue,
    })
    .from(payments)
    .leftJoin(users, eq(payments.userId, users.id))
    .orderBy(desc(payments.createdAt));

  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    "id", "date", "customerName", "customerEmail", "purpose", "billing",
    "credits", "amount", "currency", "status", "adminGrant", "equivalentValue",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.id,
      new Date(r.createdAt).toISOString(),
      esc(r.ownerName),
      esc(r.ownerEmail),
      r.purpose,
      r.billing ?? "",
      r.credits ?? "",
      r.amount,
      r.currency,
      r.status,
      r.grantedByAdmin ? "yes" : "no",
      r.equivalentValue ?? "",
    ].join(","));
  }
  return lines.join("\n");
}
