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
