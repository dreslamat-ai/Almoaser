// حدود الرفع: تُقبل الصيغ المدعومة، وتُرفض الكبيرة برسالةٍ تذكر الرقمين.
import { describe, it, expect } from "vitest";
import { checkUpload, uploadKindOf, UPLOAD_LIMITS, CHAT_ACCEPT, formatBytes } from "./uploadLimits";

const MB = 1024 * 1024;

describe("تمييز نوع الملف", () => {
  it("يميّز الصورة والـPDF والصوت", () => {
    expect(uploadKindOf("image/png")).toBe("image");
    expect(uploadKindOf("application/pdf")).toBe("pdf");
    expect(uploadKindOf("audio/webm")).toBe("audio");
  });
  it("لا يخمّن ما لا يعرف", () => {
    expect(uploadKindOf("application/zip")).toBeNull();
    expect(uploadKindOf("")).toBeNull();
  });
  it("حقل الاختيار في المحادثة يقبل الصور وPDF معاً", () => {
    expect(CHAT_ACCEPT).toContain("image/*");
    expect(CHAT_ACCEPT).toContain("application/pdf");
  });
});

describe("قبول ورفض", () => {
  it("يقبل صورة وPDF ضمن الحدّ", () => {
    expect(checkUpload("image/jpeg", 2 * MB)).toBeNull();
    expect(checkUpload("application/pdf", 2 * MB)).toBeNull();
    // بعض الهواتف تُرفق المحرف: image/jpeg;charset=binary
    expect(checkUpload("image/jpeg;charset=binary", MB)).toBeNull();
  });

  it("يرفض ما تجاوز الحدّ ويذكر الرقمين", () => {
    const msg = checkUpload("image/jpeg", 12 * MB);
    expect(msg).toBeTruthy();
    // «كبير جداً» وحده يجعل صاحبه يخمّن كم يُنقص
    expect(msg).toContain("12");
    expect(msg).toContain("10");
  });

  it("حدّ الـPDF أقلّ من حدّ الصورة عمداً", () => {
    expect(UPLOAD_LIMITS.pdf.maxBytes).toBeLessThan(UPLOAD_LIMITS.image.maxBytes);
    expect(checkUpload("application/pdf", 9 * MB)).toBeTruthy();
  });

  it("يرفض النوع غير المدعوم ويقول ما المدعوم", () => {
    const msg = checkUpload("application/zip", MB);
    expect(msg).toContain("PDF");
  });

  it("يرفض الملفّ الفارغ", () => {
    expect(checkUpload("image/png", 0)).toBeTruthy();
  });

  it("يرفض صيغة صورة غير مدعومة", () => {
    expect(checkUpload("image/tiff", MB)).toBeTruthy();
  });
});

describe("صياغة الأحجام", () => {
  it("بالميجابايت فوق الميجا وبالكيلو تحتها", () => {
    expect(formatBytes(10 * MB)).toContain("ميجا");
    expect(formatBytes(300 * 1024)).toContain("كيلو");
  });
});
