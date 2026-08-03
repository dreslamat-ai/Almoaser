import { erpGET } from "./erpClient";

/**
 * مديرو الأقسام — فريقٌ يراجع دفاتر صاحب النشاط نفسه.
 *
 * منقولٌ عن نظيره في AlmoaserPos بالفكرة لا بالشيفرة: هناك يُستعلم من MySQL
 * مباشرةً، وهنا من ERPNext عبر واجهته. والقواعد المحاسبية واحدة لأن المشكلة
 * واحدة — فاتورةٌ لا تطابق بنودها خللٌ في الحالين.
 *
 * ## لماذا استعلامٌ لا نموذج
 * ما يُبلَّغ به صاحب النشاط عن دفاتره يجب أن يكون صحيحاً **في كل مرة**.
 * «عندك ثلاث فواتير مجاميعها لا تطابق بنودها» جملةٌ يفتح بها دفاتره ويبني
 * عليها قراراً، ونموذجٌ يصيبها مرّة ويسهو عنها مرّة لا يصلح لها. سارة تصوغ
 * ما عُدّ ولا تُقرّره.
 *
 * ## ولا يُصلَح شيء تلقائياً
 * القسم يُبلِّغ ولا يُعدِّل. رصيدٌ سالب قد يكون خطأ إدخال وقد يكون بيعاً قبل
 * تسجيل الشراء، والفرق لا يعرفه إلا صاحبه. ومن يُصلح ما لا يفهم يُخفي العطل.
 */

/** سقف ما يُعرض من كل نوع: القائمة الطويلة لا تُقرأ */
const MAX = 5;

/** فرقٌ دون هذا تقريبٌ لا خلل */
const TOLERANCE = 0.05;

export const DEPARTMENTS = {
  accounting: "المحاسب",
  inventory: "أمين المخزن",
  credit: "مدقّق الائتمان",
  sales: "مدير المبيعات",
} as const;

export type Department = keyof typeof DEPARTMENTS;

type Row = Record<string, unknown>;

async function list(doctype: string, query: string): Promise<Row[]> {
  const r = (await erpGET(
    `/api/resource/${encodeURIComponent(doctype)}?${query}`,
  )) as { data?: Row[] };
  return Array.isArray(r?.data) ? r.data : [];
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (v: unknown) =>
  `${num(v).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;

const daysSince = (d: unknown) => {
  const t = Date.parse(String(d ?? ""));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : 0;
};

const ago = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

// ─── المحاسب ─────────────────────────────────────────────────────────────

async function auditAccounting(): Promise<string[]> {
  const out: string[] = [];

  // فاتورة مقدَّمة لا يطابق إجماليها مجموع بنودها: قيدٌ يُرحَّل خطأً لكل تقرير
  const invoices = await list(
    "Sales Invoice",
    `limit=100&filters=[["docstatus","=",1]]&fields=["name","grand_total","total","total_taxes_and_charges","discount_amount"]&order_by=posting_date desc`,
  );
  for (const inv of invoices) {
    const expected =
      num(inv.total) + num(inv.total_taxes_and_charges) - num(inv.discount_amount);
    if (Math.abs(num(inv.grand_total) - expected) > TOLERANCE) {
      out.push(
        `الفاتورة ${inv.name}: الإجمالي ${money(inv.grand_total)} ومجموع بنودها ${money(expected)}`,
      );
      if (out.length >= MAX) break;
    }
  }

  // مسودّات قديمة: بيعٌ لم يُقدَّم فلا يدخل مبيعات ولا مخزوناً
  const drafts = await list(
    "Sales Invoice",
    `limit=100&filters=[["docstatus","=",0],["posting_date","<","${ago(30)}"]]&fields=["name"]`,
  );
  if (drafts.length) {
    out.push(
      `${drafts.length} فاتورة بيع مسودّة أقدم من ثلاثين يوماً — لا تدخل المبيعات ولا المخزون`,
    );
  }

  // فاتورة بضريبة لعميلٍ بلا رقم ضريبي: نقصٌ في مستند قد يُقدَّم للهيئة
  const taxed = await list(
    "Sales Invoice",
    `limit=100&filters=[["docstatus","=",1],["total_taxes_and_charges",">",0]]&fields=["name","customer","tax_id"]`,
  );
  const missing = taxed.filter((i) => !String(i.tax_id ?? "").trim());
  if (missing.length) {
    out.push(`${missing.length} فاتورة بضريبة بلا رقم ضريبي مسجَّل للعميل`);
  }

  return out;
}

// ─── أمين المخزن ─────────────────────────────────────────────────────────

async function auditInventory(): Promise<string[]> {
  const out: string[] = [];

  // رصيدٌ سالب: بيعٌ سُجّل قبل شرائه، أو جردٌ لم يُدخَل
  const negative = await list(
    "Bin",
    `limit=${MAX}&filters=[["actual_qty","<",0]]&fields=["item_code","warehouse","actual_qty"]&order_by=actual_qty asc`,
  );
  for (const b of negative) {
    out.push(
      `«${b.item_code}» رصيده سالب في ${b.warehouse} (${num(b.actual_qty)}) — بيعٌ قبل تسجيل شرائه أو جرد ناقص`,
    );
  }

  // بلغ حدّ إعادة الطلب: نفادٌ وشيك
  const low = await list(
    "Bin",
    `limit=100&filters=[["actual_qty",">=",0]]&fields=["item_code","warehouse","actual_qty","reorder_level"]`,
  );
  let shown = 0;
  for (const b of low) {
    const level = num(b.reorder_level);
    if (level > 0 && num(b.actual_qty) <= level) {
      out.push(
        `«${b.item_code}» بلغ حدّ الطلب: المتاح ${num(b.actual_qty)} والحدّ ${level}`,
      );
      if (++shown >= MAX) break;
    }
  }

  // صنفٌ يُباع دون تكلفته: كل بيعةٍ خسارة
  const items = await list(
    "Item",
    `limit=200&filters=[["disabled","=",0],["is_sales_item","=",1]]&fields=["item_code","item_name","valuation_rate","standard_rate"]`,
  );
  let losses = 0;
  for (const it of items) {
    const cost = num(it.valuation_rate);
    const price = num(it.standard_rate);
    if (cost > 0 && price > 0 && price < cost) {
      out.push(
        `«${it.item_name ?? it.item_code}» سعر بيعه ${money(price)} وتكلفته ${money(cost)} — كل بيعة خسارة`,
      );
      if (++losses >= MAX) break;
    }
  }

  return out;
}

// ─── مدقّق الائتمان ──────────────────────────────────────────────────────

async function auditCredit(): Promise<string[]> {
  const out: string[] = [];

  // متأخراتٌ تجاوزت تسعين يوماً: أقرب ما يكون إلى دَينٍ متعثّر
  const overdue = await list(
    "Sales Invoice",
    `limit=${MAX}&filters=[["docstatus","=",1],["outstanding_amount",">",0],["posting_date","<","${ago(90)}"]]&fields=["name","customer","outstanding_amount","posting_date"]&order_by=posting_date asc`,
  );
  for (const inv of overdue) {
    out.push(
      `الفاتورة ${inv.name} لـ«${inv.customer}»: ${money(inv.outstanding_amount)} متأخرة ${daysSince(inv.posting_date)} يوماً`,
    );
  }

  // تجاوز حدّ الائتمان: بيعٌ آجل فوق ما اتُّفق عليه
  const customers = await list(
    "Customer",
    `limit=200&fields=["name","customer_name"]`,
  );
  const open = await list(
    "Sales Invoice",
    `limit=500&filters=[["docstatus","=",1],["outstanding_amount",">",0]]&fields=["customer","outstanding_amount"]`,
  );
  const balance = new Map<string, number>();
  for (const inv of open) {
    const k = String(inv.customer ?? "");
    balance.set(k, (balance.get(k) ?? 0) + num(inv.outstanding_amount));
  }
  let over = 0;
  for (const c of customers) {
    const limits = await list(
      "Customer Credit Limit",
      `limit=1&filters=[["parent","=","${String(c.name).replace(/"/g, "")}"]]&fields=["credit_limit"]&parent=Customer`,
    ).catch(() => [] as Row[]);
    const limit = num(limits[0]?.credit_limit);
    const bal = balance.get(String(c.name)) ?? 0;
    if (limit > 0 && bal > limit) {
      out.push(
        `«${c.customer_name ?? c.name}» رصيده ${money(bal)} وحدّه ${money(limit)}`,
      );
      if (++over >= MAX) break;
    }
  }

  return out;
}

// ─── مدير المبيعات ───────────────────────────────────────────────────────

async function auditSales(): Promise<string[]> {
  const out: string[] = [];

  // عميلٌ كان يشتري ثم توقّف: أقرب فرصةٍ للاسترداد
  const recent = await list(
    "Sales Invoice",
    `limit=500&filters=[["docstatus","=",1]]&fields=["customer","posting_date"]&order_by=posting_date desc`,
  );
  const seen = new Map<string, { last: string; n: number }>();
  for (const inv of recent) {
    const k = String(inv.customer ?? "");
    const cur = seen.get(k);
    const d = String(inv.posting_date ?? "");
    if (!cur) seen.set(k, { last: d, n: 1 });
    else seen.set(k, { last: cur.last > d ? cur.last : d, n: cur.n + 1 });
  }
  const lapsed = Array.from(seen.entries())
    .filter(([, v]) => v.n >= 3 && daysSince(v.last) > 60)
    .sort((a, b) => daysSince(b[1].last) - daysSince(a[1].last))
    .slice(0, MAX);
  for (const [name, v] of lapsed) {
    out.push(`«${name}» اشترى ${v.n} مرة وآخرها قبل ${daysSince(v.last)} يوماً`);
  }

  return out;
}

const AUDITS: Record<Department, () => Promise<string[]>> = {
  accounting: auditAccounting,
  inventory: auditInventory,
  credit: auditCredit,
  sales: auditSales,
};

/**
 * @param department أحد أقسام DEPARTMENTS، أو "all"
 * @returns نصّ عربي تصوغه سارة للمستخدم
 */
export async function reviewDepartments(
  department: Department | "all" = "all",
): Promise<string> {
  const keys: Department[] =
    department === "all" || !(department in DEPARTMENTS)
      ? (Object.keys(DEPARTMENTS) as Department[])
      : [department as Department];

  const sections: string[] = [];
  let total = 0;

  for (const key of keys) {
    let findings: string[];
    try {
      findings = await AUDITS[key]();
    } catch (e) {
      // قسمٌ تعذّر لا يُسقط البقية، ولا يُقال عنه «لا ملاحظات» — الصمت
      // الكاذب أسوأ من الإخفاق المُعلن.
      findings = [
        `تعذّر الفحص: ${e instanceof Error ? e.message.slice(0, 90) : "خطأ"}`,
      ];
    }
    total += findings.length;
    sections.push(
      `## ${DEPARTMENTS[key]}\n` +
        (findings.length ? `  · ${findings.join("\n  · ")}` : "  لا ملاحظات."),
    );
  }

  const head =
    total === 0
      ? "راجع الفريق الدفاتر ولم يجد ما ينبّه إليه."
      : `راجع الفريق الدفاتر ووجد ${total} ملاحظة:`;

  return (
    `${head}\n\n${sections.join("\n\n")}\n\n` +
    "(ملاحظاتٌ للفحص لا أحكام — القسم يُبلِّغ ولا يعدّل شيئاً في النظام.)"
  );
}
