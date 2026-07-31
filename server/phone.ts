// ─── توحيد أرقام الجوال ───────────────────────────────────────────────────────
// العميل يكتب رقمه بأشكال كثيرة (05… / 5… / ‎+9665… / 009665… / بمسافات وشُرَط).
// نخزّن صيغة واحدة فقط (E.164) لأن التحقق ومزوّد الرسائل يحتاجانها، ولأن
// رقمين بصيغتين مختلفتين يجب ألا يبدوا كحسابين مختلفين.

export type PhoneResult =
  | { ok: true; e164: string; national: string }
  | { ok: false; error: string };

/** يحوّل الأرقام العربية والهندية إلى لاتينية ويزيل الفواصل */
function normalizeDigits(raw: string): string {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  let out = "";
  for (const ch of raw.trim()) {
    const ai = arabic.indexOf(ch);
    const pi = persian.indexOf(ch);
    if (ai >= 0) out += String(ai);
    else if (pi >= 0) out += String(pi);
    else if (/[0-9+]/.test(ch)) out += ch;
    // المسافات والشُرَط والأقواس تُتجاهل بصمت
  }
  return out;
}

/**
 * يقبل الصيغ السعودية الشائعة ويعيدها بصيغة ‎+9665XXXXXXXX.
 * الأرقام الدولية تُقبل كما هي إذا بدأت بـ ‎+ وكان طولها معقولاً — حتى لا
 * نمنع عميلاً مصرياً أو إماراتياً من التسجيل (لدينا عملاء خارج السعودية).
 */
export function normalizePhone(raw: string): PhoneResult {
  if (!raw?.trim()) return { ok: false, error: "رقم الجوال مطلوب" };

  let d = normalizeDigits(raw);
  if (!d) return { ok: false, error: "رقم الجوال غير صالح" };

  // 00 بادئة دولية تعادل +
  if (d.startsWith("00")) d = "+" + d.slice(2);

  // ─── سعودي ───
  let saudiCore: string | null = null;
  if (d.startsWith("+966")) saudiCore = d.slice(4);
  else if (d.startsWith("966")) saudiCore = d.slice(3);
  else if (d.startsWith("05")) saudiCore = d.slice(1);
  else if (/^5\d{8}$/.test(d)) saudiCore = d;

  if (saudiCore !== null) {
    // بعض العملاء يكتبون ‎+96605…
    if (saudiCore.startsWith("0")) saudiCore = saudiCore.slice(1);
    if (!/^5\d{8}$/.test(saudiCore)) {
      return { ok: false, error: "رقم الجوال السعودي يجب أن يبدأ بـ 05 ويتكون من 10 أرقام" };
    }
    return { ok: true, e164: `+966${saudiCore}`, national: `0${saudiCore}` };
  }

  // ─── دولي ───
  if (d.startsWith("+")) {
    const digits = d.slice(1);
    if (!/^\d{8,15}$/.test(digits)) {
      return { ok: false, error: "رقم الجوال الدولي غير صالح — أدخله بصيغة ‎+CountryCode ثم الرقم" };
    }
    return { ok: true, e164: `+${digits}`, national: `+${digits}` };
  }

  return { ok: false, error: "أدخل رقماً سعودياً يبدأ بـ 05، أو رقماً دولياً يبدأ بـ +" };
}

/** للعرض فقط: ‎+966501234567 → ‎+9665•••••567 */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return "•".repeat(e164.length);
  const head = e164.slice(0, 5);
  const tail = e164.slice(-3);
  return `${head}${"•".repeat(Math.max(0, e164.length - 8))}${tail}`;
}
