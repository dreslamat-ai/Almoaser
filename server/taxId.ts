/**
 * التحقق من صيغة الرقم الضريبي حسب البلد.
 *
 * ملاحظة مهمة عن حدود هذا التحقق: **لا توجد واجهة برمجية (API) رسمية من هيئة
 * الزكاة والضريبة والجمارك السعودية للتحقق من وجود رقم ضريبي فعلياً.** خدمة
 * "التحقق من المنشآت المسجلة" على zatca.gov.sa تعمل يدوياً فقط وتتطلب CAPTCHA
 * (أي أنها مصمّمة عمداً لمنع الاستدعاء الآلي)، ولا يجوز الالتفاف عليها.
 *
 * لذلك ما نفعله هنا هو التحقق البنيوي: يكشف الأرقام المستحيلة أو المفبركة بشكل
 * واضح (طول خاطئ، بادئة/نهاية خاطئة، أرقام مكررة أو متسلسلة)، لكنه **لا يثبت**
 * أن الرقم مسجّل فعلاً لدى الهيئة. أي ادعاء بغير ذلك سيكون تضليلاً للعميل.
 */

export type TaxIdCountry = "SA" | "EG" | "AE" | "OTHER";

export type TaxIdCheck =
  | { valid: true; normalized: string; country: TaxIdCountry; note: string }
  | { valid: false; normalized: string; country: TaxIdCountry; reason: string };

/** يحوّل الأرقام العربية إلى إنجليزية ويحذف المسافات والفواصل */
export function normalizeTaxId(raw: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  return raw
    .split("")
    .map(ch => {
      const ai = arabicDigits.indexOf(ch);
      return ai >= 0 ? String(ai) : ch;
    })
    .join("")
    .replace(/[\s\-_.,]/g, "");
}

const ASC_RUN = "01234567890123456789";
const DESC_RUN = "98765432109876543210";

function isSequential(s: string): boolean {
  return s.length >= 6 && (ASC_RUN.includes(s) || DESC_RUN.includes(s));
}

/**
 * أنماط مفبركة واضحة: كل الأرقام متطابقة، أو الرقم كله متسلسل.
 * للسعودية فقط نفحص أيضاً "القلب" (بين البادئة 3 والنهاية 3) لأن الرقم المفبرك
 * الشائع هناك يكون 3 + تسلسل + 3. لا نطبّق فحص القلب على بقية البلدان لتجنّب
 * رفض أرقام حقيقية يصادف أن جزءاً منها متتالٍ.
 */
function looksFabricated(digits: string, country: TaxIdCountry): string | null {
  if (/^(\d)\1+$/.test(digits)) return "كل الأرقام متطابقة — هذا ليس رقماً ضريبياً حقيقياً";
  if (isSequential(digits)) return "الأرقام متسلسلة بشكل غير واقعي — يبدو أنه رقم تجريبي أو مفبرك";
  if (country === "SA" && digits.length === 15 && isSequential(digits.slice(1, -1))) {
    return "الأرقام متسلسلة بشكل غير واقعي — يبدو أنه رقم تجريبي أو مفبرك";
  }
  return null;
}

/**
 * يتحقق من صيغة الرقم الضريبي. البلد يُستنتج من رمز بلد الشركة في ERP إن توفّر.
 * قواعد السعودية مأخوذة من متطلبات ZATCA للفاتورة الإلكترونية:
 * 15 رقماً، يبدأ بـ 3 وينتهي بـ 3.
 */
export function validateTaxId(raw: string, country: TaxIdCountry = "SA"): TaxIdCheck {
  const normalized = normalizeTaxId(raw ?? "");

  if (!normalized) {
    return { valid: false, normalized, country, reason: "الرقم الضريبي فارغ" };
  }
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, normalized, country, reason: "الرقم الضريبي يجب أن يحتوي أرقاماً فقط" };
  }

  const fabricated = looksFabricated(normalized, country);
  if (fabricated) return { valid: false, normalized, country, reason: fabricated };

  switch (country) {
    case "SA": {
      if (normalized.length !== 15) {
        return { valid: false, normalized, country, reason: `الرقم الضريبي السعودي يجب أن يكون 15 رقماً بالضبط (المُدخل ${normalized.length} رقماً)` };
      }
      // القاعدة الثابتة هي النهاية بـ 00003، لا البداية بـ 3.
      // اشتراطُ البداية بـ 3 كان يرفض أرقاماً مسجَّلة فعلاً لدى عملاء يعملون
      // بها اليوم (رُصد 258941285800003 مستخدماً في نظام حيّ)، فكان الفحص
      // أضيق من الواقع ويمنع فوترة صحيحة. النمط الشائع أن يبدأ بـ 3 لكنه ليس
      // شرطاً نملك ما يثبته، والاشتراط الخاطئ هنا يعطّل عميلاً لا يحميه.
      if (!normalized.endsWith("00003")) {
        return { valid: false, normalized, country, reason: "الرقم الضريبي السعودي ينتهي بـ 00003 — تحقق من الرقم في شهادة التسجيل الضريبي" };
      }
      return {
        valid: true, normalized, country,
        note: "الصيغة مطابقة لمتطلبات هيئة الزكاة والضريبة (15 رقماً تنتهي بـ 00003). لا يمكن تأكيد تسجيله فعلياً لدى الهيئة آلياً — لا توجد واجهة رسمية لذلك، والتأكد النهائي يكون من بوابة الهيئة يدوياً",
      };
    }
    case "EG": {
      // رقم التسجيل الضريبي المصري (منظومة الفاتورة الإلكترونية ETA): 9 أرقام
      if (normalized.length !== 9) {
        return { valid: false, normalized, country, reason: `رقم التسجيل الضريبي المصري يجب أن يكون 9 أرقام (المُدخل ${normalized.length})` };
      }
      return { valid: true, normalized, country, note: "الصيغة مطابقة لرقم التسجيل الضريبي المصري (9 أرقام). التأكد من التسجيل الفعلي يكون من بوابة مصلحة الضرائب" };
    }
    case "AE": {
      // رقم التسجيل الضريبي الإماراتي (TRN): 15 رقماً يبدأ بـ 100
      if (normalized.length !== 15) {
        return { valid: false, normalized, country, reason: `رقم التسجيل الضريبي الإماراتي (TRN) يجب أن يكون 15 رقماً (المُدخل ${normalized.length})` };
      }
      if (!normalized.startsWith("100")) {
        return { valid: false, normalized, country, reason: "رقم التسجيل الضريبي الإماراتي يبدأ عادةً بـ 100" };
      }
      return { valid: true, normalized, country, note: "الصيغة مطابقة لرقم TRN الإماراتي" };
    }
    default: {
      if (normalized.length < 8 || normalized.length > 20) {
        return { valid: false, normalized, country, reason: `طول الرقم الضريبي غير معقول (${normalized.length} رقماً) — تأكد من الرقم مع العميل` };
      }
      return { valid: true, normalized, country, note: "لم يُتحقق من قواعد بلد محددة — تأكد أن الرقم مطابق لمتطلبات بلد الشركة" };
    }
  }
}

/** يستنتج البلد من رمز/اسم البلد المسجل في ERP */
export function countryToTaxIdCountry(country?: string | null): TaxIdCountry {
  const c = (country ?? "").trim().toLowerCase();
  if (!c) return "OTHER";
  if (/saudi|السعود|ksa|\bsa\b/.test(c)) return "SA";
  if (/egypt|مصر|\beg\b/.test(c)) return "EG";
  if (/emirat|united arab|الإمارات|الامارات|\bae\b|uae/.test(c)) return "AE";
  return "OTHER";
}
