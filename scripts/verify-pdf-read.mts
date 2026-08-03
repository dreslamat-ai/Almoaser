// تحقّق حيّ: هل يقرأ الوكيل فاتورةً في ملفّ PDF فعلاً؟
// يُبنى ملفّ PDF بسيط فيه نصّ فاتورة، ويُمرَّر بمسار الاستخراج نفسه الذي
// تستعمله المحادثة، ويُقارَن ما استُخرج بما كُتب.
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { users } from "../drizzle/schema";
import { appRouter } from "../server/routers";
import { resolveOrgOwnerId } from "../server/organizations";

/** ملفّ PDF أدنى ما يكون: صفحة واحدة بنصٍّ مكتوب (لا صورة ممسوحة) */
function makePdf(lines: string[]): Buffer {
  const text = lines
    .map((l, i) => `BT /F1 14 Tf 60 ${760 - i * 24} Td (${l.replace(/[()\\]/g, "")}) Tj ET`)
    .join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    + offsets.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const email = process.env.TELEGRAM_OWNER_EMAIL?.trim();
if (!email) throw new Error("TELEGRAM_OWNER_EMAIL غير مضبوط");
const db = await getDb();
if (!db) throw new Error("لا قاعدة بيانات");
const owner = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
if (!owner) throw new Error(`لا مستخدم بالبريد ${email}`);

const caller = appRouter.createCaller({
  req: { headers: {} } as never, res: undefined as never,
  user: owner, effectiveUserId: await resolveOrgOwnerId(owner),
} as never);

const pdf = makePdf([
  "TAX INVOICE",
  "Invoice No: INV-TEST-9911",
  "Customer: Alnoor Trading Company",
  "Date: 2026-08-03",
  "Item: Consulting services   Qty 2   Rate 500   Amount 1000",
  "VAT 15%: 150",
  "Total: 1150 SAR",
]);
console.log(`ملفّ PDF بحجم ${pdf.length} بايت`);

// ١) الرفض قبل القبول: ملفّ يتجاوز الحدّ يجب أن يُردّ برسالةٍ تذكر الرقمين
try {
  await caller.agent.extractDocument({
    imageBase64: Buffer.alloc(9 * 1024 * 1024).toString("base64"),
    mimeType: "application/pdf",
    fileName: "كبير.pdf",
  });
  console.log("✗ قُبل ملفّ يتجاوز الحدّ");
} catch (e) {
  console.log("✓ رُفض ما تجاوز الحدّ:", (e as Error).message.slice(0, 80));
}

// ٢) نوعٌ غير مدعوم
try {
  await caller.agent.extractDocument({ imageBase64: "AAAA", mimeType: "application/zip" });
  console.log("✗ قُبل نوع غير مدعوم");
} catch (e) {
  console.log("✓ رُفض النوع غير المدعوم:", (e as Error).message.slice(0, 60));
}

// ٣) القراءة الحقيقية
const t0 = Date.now();
const { extracted } = await caller.agent.extractDocument({
  imageBase64: pdf.toString("base64"),
  mimeType: "application/pdf",
  fileName: "invoice-test.pdf",
});
console.log(`\nقُرئ في ${((Date.now() - t0) / 1000).toFixed(1)}ث:`);
console.log(JSON.stringify(extracted, null, 1).slice(0, 700));

const ok = [
  ["رقم المستند", String(extracted.invoice_number ?? "").includes("9911")],
  ["اسم الطرف", /noor|نور/i.test(String(extracted.party_name ?? ""))],
  ["الإجمالي", Math.abs(Number(extracted.total_amount) - 1150) < 1],
  ["الضريبة", Math.abs(Number(extracted.vat_amount) - 150) < 1],
] as const;
let bad = 0;
for (const [label, pass] of ok) { console.log(`${pass ? "✓" : "✗"} ${label}`); if (!pass) bad++; }
process.exit(bad ? 1 : 0);
