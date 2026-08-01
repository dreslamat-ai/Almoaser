// إنشاء جدول أسعار الأسواق + تثبيت السعر على الاشتراك.
//
// مكتوب يدوياً لا بـdrizzle-kit: الأخير حاول مرة `truncate table` على قاعدة
// إنتاج فيها بيانات عملاء. كل عبارة هنا مقروءة ومقصودة.
//
// يعمل بالمعاينة افتراضياً. للتنفيذ: --apply
import "dotenv/config";
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const u = new URL(process.env.DATABASE_URL!);
const c = await mysql.createConnection({
  host: u.hostname, port: Number(u.port || 3306),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: u.pathname.slice(1), multipleStatements: false,
});

const has = async (table: string, column?: string) => {
  const [r] = await c.query<never[]>(
    column
      ? "select 1 from information_schema.columns where table_schema=database() and table_name=? and column_name=?"
      : "select 1 from information_schema.tables where table_schema=database() and table_name=?",
    column ? [table, column] : [table],
  );
  return r.length > 0;
};

const steps: Array<{ label: string; sql: string; skip: () => Promise<boolean> }> = [
  {
    label: "جدول plan_prices",
    skip: () => has("plan_prices"),
    sql: `create table plan_prices (
      id int auto_increment primary key,
      planId int not null,
      market varchar(2) not null,
      currency varchar(3) not null,
      price decimal(10,2) not null,
      -- الضريبة مع الصف لا في الكود: تغييرها لسوق ما يصير تعديل بيانات
      vatRatePct decimal(5,2) not null default 15.00,
      -- سوق معطّل يبقى صفّه محفوظاً بسعره بدل أن يُحذف ويُعاد ضبطه
      isActive boolean not null default true,
      createdAt timestamp not null default current_timestamp,
      updatedAt timestamp not null default current_timestamp on update current_timestamp,
      unique key uq_plan_market (planId, market),
      constraint fk_plan_prices_plan foreign key (planId) references plans(id) on delete cascade
    ) engine=InnoDB default charset=utf8mb4`,
  },
  {
    // بلا هذا يُعاد تسعير مشترك قائم عند التجديد لو تغيّر موقعه أو تغيّر الجدول
    label: "subscriptions.priceAtPurchase",
    skip: () => has("subscriptions", "priceAtPurchase"),
    sql: "alter table subscriptions add column priceAtPurchase decimal(10,2) null",
  },
  {
    label: "subscriptions.currencyAtPurchase",
    skip: () => has("subscriptions", "currencyAtPurchase"),
    sql: "alter table subscriptions add column currencyAtPurchase varchar(3) null",
  },
  {
    label: "subscriptions.marketAtPurchase",
    skip: () => has("subscriptions", "marketAtPurchase"),
    sql: "alter table subscriptions add column marketAtPurchase varchar(2) null",
  },
];

console.log(APPLY ? "═══ تنفيذ ═══\n" : "═══ معاينة (بلا كتابة) ═══\n");
for (const s of steps) {
  if (await s.skip()) { console.log(`↷ ${s.label} — موجود`); continue; }
  console.log(`${APPLY ? "▶" : "·"} ${s.label}`);
  if (APPLY) await c.query(s.sql);
}

// بذر السعودية بأسعار اليوم: لا يتغيّر شيء في السلوك حتى تُضاف أسواق أخرى
if (APPLY && await has("plan_prices")) {
  const [plans] = await c.query<Array<{ id: number; price: string; currency: string }>>(
    "select id, price, currency from plans",
  );
  for (const p of plans) {
    await c.query(
      `insert into plan_prices (planId, market, currency, price, vatRatePct)
       values (?, 'SA', ?, ?, 15.00)
       on duplicate key update price = values(price)`,
      [p.id, p.currency || "SAR", p.price],
    );
  }
  console.log(`\n✓ بُذرت أسعار السعودية لـ${plans.length} باقة`);

  // تثبيت أسعار المشتركين الحاليين على ما اشتركوا به فعلاً
  const [r] = await c.query<{ affectedRows: number }[] & { affectedRows: number }>(
    `update subscriptions s join plans p on p.id = s.planId
     set s.priceAtPurchase = p.price, s.currencyAtPurchase = p.currency, s.marketAtPurchase = 'SA'
     where s.priceAtPurchase is null`,
  );
  console.log(`✓ ثُبِّت سعر ${(r as unknown as { affectedRows: number }).affectedRows} اشتراكاً قائماً`);
}

if (!APPLY) console.log("\nللتنفيذ: npx tsx scripts/apply-plan-prices.mts --apply");
await c.end();
process.exit(0);
