// ─── التسعير حسب السوق ────────────────────────────────────────────────────────
//
// السعر ليس معادلة تُشتق من سعر الصرف: ما يُقنع في الرياض لا يُقنع في القاهرة،
// والرقم يُختار سوقاً بسوق. لذلك الأسعار **بيانات في جدول** لا حساب في الكود —
// فتح سوق جديد صفٌّ يُضاف، لا إصدار يُنشر.
//
// **الضريبة:** قرار العمل الحالي أن تُطبَّق ١٥٪ على كل العملاء أينما كانوا،
// وهي نسبة تسجيلنا السعودي. تُخزَّن مع كل صف سعر لا كثابت في الكود، كي يكون
// تغييرها لاحقاً — لسوق يقتضي معاملة أخرى — تعديلَ بيانات لا تعديلَ برنامج.

/** الأسواق التي نعرف كيف نسعّر فيها. التوسّع يبدأ من هنا. */
export type MarketCode = "SA" | "EG" | "AE" | "KW" | "QA" | "BH" | "OM" | "JO";

export const DEFAULT_MARKET: MarketCode = "SA";

export type Currency = "SAR" | "EGP" | "AED" | "KWD" | "QAR" | "BHD" | "OMR" | "JOD";

export type MarketInfo = {
  code: MarketCode;
  nameAr: string;
  currency: Currency;
  currencyNameAr: string;
  /** خانات الكسر في العرض — الدينار ثلاث لا اثنتان */
  fractionDigits: number;
};

export const MARKETS: Record<MarketCode, MarketInfo> = {
  SA: { code: "SA", nameAr: "السعودية", currency: "SAR", currencyNameAr: "ريال", fractionDigits: 2 },
  EG: { code: "EG", nameAr: "مصر", currency: "EGP", currencyNameAr: "جنيه", fractionDigits: 2 },
  AE: { code: "AE", nameAr: "الإمارات", currency: "AED", currencyNameAr: "درهم", fractionDigits: 2 },
  KW: { code: "KW", nameAr: "الكويت", currency: "KWD", currencyNameAr: "دينار", fractionDigits: 3 },
  QA: { code: "QA", nameAr: "قطر", currency: "QAR", currencyNameAr: "ريال", fractionDigits: 2 },
  BH: { code: "BH", nameAr: "البحرين", currency: "BHD", currencyNameAr: "دينار", fractionDigits: 3 },
  OM: { code: "OM", nameAr: "عُمان", currency: "OMR", currencyNameAr: "ريال", fractionDigits: 3 },
  JO: { code: "JO", nameAr: "الأردن", currency: "JOD", currencyNameAr: "دينار", fractionDigits: 3 },
};

export function isMarketCode(v: unknown): v is MarketCode {
  return typeof v === "string" && v in MARKETS;
}

/** مفاتيح الاتصال الدولية → السوق. الجوال أدقّ من الـIP: العميل كتبه بنفسه. */
const DIAL_TO_MARKET: Array<[prefix: string, market: MarketCode]> = [
  ["+966", "SA"], ["+20", "EG"], ["+971", "AE"], ["+965", "KW"],
  ["+974", "QA"], ["+973", "BH"], ["+968", "OM"], ["+962", "JO"],
];

/** السوق المستفاد من رقم جوال بصيغة E.164، أو undefined إن لم يُعرف. */
export function marketFromPhone(e164: string | null | undefined): MarketCode | undefined {
  if (!e164) return undefined;
  const p = e164.trim();
  // الأطول أولاً كي لا يبتلع +97 مفتاحَي الإمارات وقطر
  for (const [prefix, market] of [...DIAL_TO_MARKET].sort((a, b) => b[0].length - a[0].length)) {
    if (p.startsWith(prefix)) return market;
  }
  return undefined;
}

/**
 * السوق المعتمد، بترتيب ثقة تنازلي.
 *
 * اختيار العميل الصريح يعلو على كل استنتاج: من بدّل العملة بنفسه قال ما يريد،
 * وتخطّيه بتخمين من الـIP إهانة لاختياره. والـIP آخر الترتيب لأنه أضعفها —
 * مسافر أو شبكة شركة تُخرج نتيجة خاطئة، ولهذا يبقى مبدّل العملة ظاهراً دائماً.
 */
export function resolveMarket(signals: {
  explicit?: string | null;
  phone?: string | null;
  ipCountry?: string | null;
}): MarketCode {
  if (isMarketCode(signals.explicit)) return signals.explicit;
  const byPhone = marketFromPhone(signals.phone);
  if (byPhone) return byPhone;
  const ip = signals.ipCountry?.toUpperCase();
  if (isMarketCode(ip)) return ip;
  return DEFAULT_MARKET;
}

/** تنسيق مبلغ بعملة سوقه — بالأرقام الهندية كبقية الواجهة. */
export function formatMoney(amount: number, market: MarketCode, arabicDigits = true): string {
  const info = MARKETS[market];
  const n = amount.toFixed(info.fractionDigits);
  const text = `${n} ${info.currencyNameAr}`;
  if (!arabicDigits) return text;
  return text.replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/**
 * تفصيل مبلغ معلن إلى صافٍ وضريبة وإجمالي بنسبة السوق.
 *
 * الإجمالي يُقرَّب أولاً ثم تُشتق الضريبة بالطرح: لو قُرِّب كلٌّ على حدة لظهرت
 * صفوف صافيها + ضريبتها ≠ إجماليها بفرق هللة، فيكفّ (الإجمالي − الضريبة) عن
 * مساواة السعر المعلن للعميل.
 */
export function withVatRate(net: number, vatRatePct: number): { net: number; vat: number; total: number } {
  const roundedNet = Math.round(net * 100) / 100;
  const total = Math.round(roundedNet * (1 + vatRatePct / 100) * 100) / 100;
  return { net: roundedNet, vat: Math.round((total - roundedNet) * 100) / 100, total };
}
