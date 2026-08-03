// استهلاك سارة اليوم بالموديل: أين تُنفَق الثواني والدولارات؟
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const q = async (s: string) => {
  const [rows] = (await db.execute(sql.raw(s))) as unknown as [Array<Record<string, unknown>>];
  return rows;
};

const cols = await q("SHOW COLUMNS FROM llm_usage_log");
const names = cols.map(c => String(c.Field));
const hasLatency = names.includes("latencyMs") || names.includes("durationMs");
const latCol = names.includes("latencyMs") ? "latencyMs" : names.includes("durationMs") ? "durationMs" : null;

const rows = await q(`
  SELECT app, model, COUNT(*) calls, ROUND(SUM(costUsd),4) cost, ROUND(AVG(costUsd),5) per
         ${latCol ? `, ROUND(AVG(${latCol})) ms, ROUND(MAX(${latCol})) worst` : ""}
  FROM llm_usage_log
  WHERE createdAt >= CURDATE() - INTERVAL 2 DAY
  GROUP BY app, model ORDER BY cost DESC`);

console.log(`الأعمدة: ${names.join("، ")}\n`);
for (const r of rows) {
  console.log(
    `${String(r.app).padEnd(8)} ${String(r.model).padEnd(32)} ${String(r.calls).padStart(4)} نداء` +
    ` · $${r.cost} · $${r.per}/نداء` +
    (hasLatency ? ` · متوسط ${r.ms}ms · أسوأ ${r.worst}ms` : ""),
  );
}
process.exit(0);
