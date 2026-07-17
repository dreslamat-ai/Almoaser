import { describe, expect, it } from "vitest";

// نعيد تعريف الدوال محلياً بنفس منطق agent.ts لاختبارها كوحدات نقية
// (الدوال في agent.ts غير مُصدَّرة لأنها داخلية)
function normalizeArabic(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSimilar(a: string, b: string): boolean {
  const na = normalizeArabic(a);
  const nb = normalizeArabic(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// نسخة مطابقة لدالة buildSearchVariants في agent.ts
function buildSearchVariants(word: string): string[] {
  const variants = new Set<string>();
  const add = (w: string) => { if (w) variants.add(w); };
  add(word);
  const base = word.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  add(base);
  if (/^[اأإآ]/.test(base)) {
    for (const alef of ["ا", "أ", "إ", "آ"]) add(alef + base.slice(1));
  }
  const expanded = Array.from(variants);
  for (const v of expanded) {
    if (v.endsWith("ه")) add(v.slice(0, -1) + "ة");
    if (v.endsWith("ة")) add(v.slice(0, -1) + "ه");
    if (v.endsWith("ي")) add(v.slice(0, -1) + "ى");
    if (v.endsWith("ى")) add(v.slice(0, -1) + "ي");
  }
  return Array.from(variants).slice(0, 8);
}

describe("buildSearchVariants — متغيرات الهمزات للبحث في ERPNext", () => {
  it("اسلام تولد إسلام وأسلام وآسلام", () => {
    const variants = buildSearchVariants("اسلام");
    expect(variants).toContain("اسلام");
    expect(variants).toContain("إسلام");
    expect(variants).toContain("أسلام");
    expect(variants).toContain("آسلام");
  });
  it("العكس: إسلام تولد اسلام وأسلام", () => {
    const variants = buildSearchVariants("إسلام");
    expect(variants).toContain("اسلام");
    expect(variants).toContain("أسلام");
  });
  it("أحمد تولد احمد", () => {
    expect(buildSearchVariants("أحمد")).toContain("احمد");
  });
  it("خدمة تولد خدمه", () => {
    expect(buildSearchVariants("خدمة")).toContain("خدمه");
  });
  it("مصطفى تولد مصطفي", () => {
    expect(buildSearchVariants("مصطفى")).toContain("مصطفي");
  });
  it("اسم بلا همزات يبقى ضمن المتغيرات ولا يتجاوز العدد 8", () => {
    expect(buildSearchVariants("محمود")).toContain("محمود");
    expect(buildSearchVariants("إسلامة").length).toBeLessThanOrEqual(8);
  });
});

describe("normalizeArabic", () => {
  it("توحيد الهمزات والألف", () => {
    expect(normalizeArabic("أحمد")).toBe(normalizeArabic("احمد"));
    expect(normalizeArabic("إبراهيم")).toBe(normalizeArabic("ابراهيم"));
  });
  it("توحيد التاء المربوطة والألف المقصورة", () => {
    expect(normalizeArabic("خدمة استشارية")).toBe(normalizeArabic("خدمه استشاريه"));
    expect(normalizeArabic("مصطفى")).toBe(normalizeArabic("مصطفي"));
  });
  it("إزالة التشكيل والمسافات الزائدة", () => {
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("  محمود   علي ")).toBe("محمود علي");
  });
});

describe("isSimilar", () => {
  it("تطابق تام بعد التطبيع", () => {
    expect(isSimilar("محمود", "محمود")).toBe(true);
    expect(isSimilar("خدمة استشارية", "خدمه استشاريه")).toBe(true);
  });
  it("تطابق جزئي (احتواء)", () => {
    expect(isSimilar("شركة النور للتجارة", "النور")).toBe(true);
    expect(isSimilar("محمود", "محمود أحمد")).toBe(true);
  });
  it("عدم تطابق أسماء مختلفة", () => {
    expect(isSimilar("محمود", "خالد")).toBe(false);
    expect(isSimilar("خدمة استشارية", "تطوير برمجيات")).toBe(false);
  });
  it("نصوص فارغة لا تتطابق", () => {
    expect(isSimilar("", "محمود")).toBe(false);
  });
});

function translateErpError(raw: string): string {
  if (/LinkValidationError|Could not find/i.test(raw)) {
    const m = raw.match(/Could not find ([^:]+): ([^"\\,}]+)/i);
    if (m) return `السجل المرتبط غير موجود: ${m[1]} "${m[2]}" — ابحث عنه أولاً أو أنشئه ثم أعد المحاولة`;
    return "أحد السجلات المرتبطة (عميل/صنف/حساب) غير موجود في النظام";
  }
  if (/DuplicateEntryError|already exists/i.test(raw)) return "السجل موجود مسبقاً — استخدم الموجود بدلاً من إنشاء نسخة مكررة";
  if (/MandatoryError|is mandatory/i.test(raw)) return "حقل إلزامي ناقص: " + raw.slice(0, 200);
  if (/PermissionError|not permitted/i.test(raw)) return "صلاحيات غير كافية لتنفيذ هذه العملية في ERPNext";
  if (/ValidationError/i.test(raw)) return "خطأ تحقق من ERPNext: " + raw.slice(0, 200);
  return raw.slice(0, 300);
}

describe("translateErpError", () => {
  it("ترجمة خطأ سجل مرتبط مفقود", () => {
    expect(translateErpError("LinkValidationError: Could not find Customer: محمود")).toContain("غير موجود");
  });
  it("ترجمة خطأ التكرار", () => {
    expect(translateErpError("DuplicateEntryError: Item already exists")).toContain("موجود مسبقاً");
  });
  it("ترجمة خطأ الصلاحيات", () => {
    expect(translateErpError("PermissionError: not permitted")).toContain("صلاحيات");
  });
});
