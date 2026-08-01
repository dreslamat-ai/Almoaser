import { describe, it, expect } from "vitest";
import { crossCheckCertificate, missingRequiredFields } from "./vatCertificate";

// أرقام من شهادة حقيقية: TIN 3124593272 → VAT 312459327200003
const REAL_VAT = "312459327200003";
const REAL_TIN = "3124593272";
// رقم الشهادة في أعلى الصفحة — الخطأ الذي وقع فيه الاستخراج النصي فعلاً
const CERT_NO = "100251149418367";

describe("crossCheckCertificate", () => {
  it("يقبل شهادة صحيحة", () => {
    expect(crossCheckCertificate(REAL_VAT, REAL_TIN)).toEqual({ ok: true });
  });

  // المزلق الأساسي: رقم الشهادة 15 رقماً أيضاً، فالطول وحده لا يكفي
  it("يرفض رقم الشهادة إذا قُرئ مكان الرقم الضريبي", () => {
    const r = crossCheckCertificate(CERT_NO, REAL_TIN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("00003");
  });

  it("يرفض عدم تطابق الرقم المميز مع بداية الرقم الضريبي", () => {
    const r = crossCheckCertificate(REAL_VAT, "9999999999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("الرقم المميز");
  });

  it("يرفض طولاً خاطئاً", () => {
    expect(crossCheckCertificate("31245932720003", REAL_TIN).ok).toBe(false);
    expect(crossCheckCertificate("3124593272000033", REAL_TIN).ok).toBe(false);
  });

  it("يتجاهل المسافات والفواصل في القراءة", () => {
    expect(crossCheckCertificate("3124 5932 7200 003", "3124 593272")).toEqual({ ok: true });
  });

  it("يمرّ بلا رقم مميز — التحقق التقاطعي إضافي لا شرط", () => {
    expect(crossCheckCertificate(REAL_VAT, "")).toEqual({ ok: true });
  });

  it("يرفض رقماً ينتهي بـ 3 لكن ليس 00003", () => {
    const r = crossCheckCertificate("312459327289003", "3124593272");
    expect(r.ok).toBe(false);
  });
});

describe("missingRequiredFields", () => {
  const full = { taxpayerName: "شركة حلول الأفق المميزة", vatNumber: REAL_VAT, address: "الرياض، المربع، 12613" };

  it("لا ينقص شيء من شهادة كاملة", () => {
    expect(missingRequiredFields(full)).toEqual([]);
  });

  // الثلاثة التي تُلزم بها الهيئة في الفاتورة الضريبية
  it("يرصد كل حقل إلزامي غائب", () => {
    expect(missingRequiredFields({ ...full, taxpayerName: "" })).toContain("اسم المكلف");
    expect(missingRequiredFields({ ...full, vatNumber: "  " })).toContain("رقم التسجيل الضريبي");
    expect(missingRequiredFields({ ...full, address: undefined })).toContain("العنوان الوطني");
  });

  it("يرصد النواقص مجتمعة لا أولها", () => {
    expect(missingRequiredFields({}).length).toBe(3);
  });
});
