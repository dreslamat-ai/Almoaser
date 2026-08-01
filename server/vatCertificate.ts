// ─── قراءة شهادة التسجيل الضريبي (هيئة الزكاة والضريبة والجمارك) ─────────────
//
// العملاء يرسلون الشهادة نفسها التي تصدرها الهيئة، وفيها كل ما نحتاجه لتسجيل
// بياناتهم: الاسم القانوني، رقم التسجيل الضريبي، العنوان، السجل التجاري.
//
// **لماذا صورة لا نص:** الشهادة نموذج Adobe LiveCycle ونصّها مُرمَّز بأكواد
// خطوط، فالاستخراج النصي يعطي أرقاماً موجودة في الملف لكنها ليست المطلوبة —
// جرّبناه فأعاد رقم الشهادة (100251149418367) ورقماً آخر بدل رقم التسجيل
// الضريبي الحقيقي (312459327200003). قراءة خاطئة تُسجَّل بثقة أسوأ من فشل صريح،
// لذلك تُحوَّل الصفحة إلى صورة وتُقرأ بالرؤية.

import { spawn } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export type VatCertificateData = {
  taxpayerName: string;
  vatNumber: string;
  tin: string;
  address: string;
  crNumber: string;
  registrationDate: string;
  taxPeriod: string;
};

/** يحوّل أول صفحة من PDF إلى PNG عبر Ghostscript. */
export async function pdfFirstPageToPng(pdf: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "vatcert-"));
  const src = join(dir, "in.pdf");
  const out = join(dir, "out.png");
  try {
    await (await import("fs/promises")).writeFile(src, pdf);
    await new Promise<void>((resolve, reject) => {
      const gs = spawn("gs", [
        // 300dpi لا 150: عند 150 قُرئ اسم المكلف "شركة حول القفا المريعة" بدل
        // "شركة حلول الأفق المميزة" — الحروف العربية متصلة وتحتاج بكسلات أكثر
        // لتُقرأ. الأرقام كانت صحيحة عند الدقتين، وهو ما يجعل الخطأ خادعاً.
        // 400dpi لم يتحسّن عن 300 وزاد الحجم، فـ300 هي نقطة الكفاية.
        "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=png16m", "-r300",
        "-dFirstPage=1", "-dLastPage=1", `-sOutputFile=${out}`, src,
      ]);
      // مهلة صريحة: ملف تالف قد يجعل gs يدور بلا نهاية ويعلّق الطلب
      const timer = setTimeout(() => { gs.kill("SIGKILL"); reject(new Error("انتهت مهلة تحويل الملف")); }, 20_000);
      gs.on("error", e => { clearTimeout(timer); reject(e); });
      gs.on("close", code => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`فشل تحويل PDF (رمز ${code})`));
      });
    });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const VAT_CERT_SYSTEM_PROMPT = `أنت تقرأ شهادة تسجيل في ضريبة القيمة المضافة صادرة من هيئة الزكاة والضريبة والجمارك السعودية.

استخرج الحقول كما هي مكتوبة حرفياً. **انتبه لهذه المزالق:**
- **رقم التسجيل الضريبي** (VAT Registration Number) 15 رقماً ينتهي بـ 00003 — وهو المطلوب.
- **رقم الشهادة** (Certificate No.) في أعلى الصفحة رقم مختلف تماماً — **لا تخلط بينهما**.
- **الرقم المميز** (TIN) 10 أرقام في أعلى الصفحة، وهو أول 10 أرقام من رقم التسجيل الضريبي.
- العنوان انسخه كاملاً بفواصله كما ظهر.

إن لم يظهر حقل بوضوح اتركه فارغاً. لا تخمّن ولا تكمل رقماً ناقصاً.`;

export const VAT_CERT_SCHEMA = {
  type: "object",
  properties: {
    taxpayer_name: { type: "string", description: "اسم المكلف كما في الشهادة" },
    vat_number: { type: "string", description: "رقم التسجيل الضريبي — 15 رقماً ينتهي بـ 00003" },
    tin: { type: "string", description: "الرقم المميز — 10 أرقام" },
    address: { type: "string", description: "عنوان المكلف كاملاً" },
    cr_number: { type: "string", description: "رقم السجل التجاري / الرخصة" },
    registration_date: { type: "string", description: "تاريخ نفاذ التسجيل" },
    tax_period: { type: "string", description: "الفترة الضريبية" },
  },
  required: ["taxpayer_name", "vat_number", "tin", "address", "cr_number", "registration_date", "tax_period"],
  additionalProperties: false,
} as const;

/**
 * تحقق تقاطعي بين الحقلين: الرقم المميز يجب أن يكون أول 10 أرقام من الرقم
 * الضريبي. اختلافهما يعني قراءة خاطئة لأحدهما — وتسجيل رقم ضريبي خاطئ يظهر على
 * كل فاتورة، فالرفض هنا أرخص من اكتشافه لاحقاً.
 */
/** الحقول التي تُلزم بها الهيئة في الفاتورة الضريبية: الاسم والرقم والعنوان */
export function missingRequiredFields(d: Partial<VatCertificateData>): string[] {
  const missing: string[] = [];
  if (!d.taxpayerName?.trim()) missing.push("اسم المكلف");
  if (!d.vatNumber?.trim()) missing.push("رقم التسجيل الضريبي");
  if (!d.address?.trim()) missing.push("العنوان الوطني");
  return missing;
}

export function crossCheckCertificate(vatNumber: string, tin: string): { ok: true } | { ok: false; reason: string } {
  const v = vatNumber.replace(/\D/g, "");
  const t = tin.replace(/\D/g, "");
  if (v.length !== 15) return { ok: false, reason: `رقم التسجيل الضريبي يجب أن يكون 15 رقماً (المقروء ${v.length})` };
  if (!v.endsWith("00003")) return { ok: false, reason: "رقم التسجيل الضريبي يجب أن ينتهي بـ 00003 — تأكد أنك لم تقرأ رقم الشهادة بدلاً منه" };
  if (t && t.length === 10 && !v.startsWith(t)) {
    return { ok: false, reason: "الرقم المميز لا يطابق بداية رقم التسجيل الضريبي — القراءة غير موثوقة" };
  }
  return { ok: true };
}
