// ─── حدود الملفات المرفوعة ───────────────────────────────────────────────────
//
// **جدولٌ واحد يقرؤه الطرفان.** كان الحدّ مكتوباً رقماً في الواجهة ورقماً في
// الخادم: الصورة عشرة ميجابايت في الموضعين بالمصادفة، والصوت خمسة عشر في
// الخادم وحده بلا فحصٍ في الواجهة إطلاقاً — فمن سجّل مقطعاً طويلاً رفعه
// كاملاً ثم رُفض بعد الانتظار. والرقمان حين ينفصلان ينحرفان.
//
// **ولماذا حدٌّ أصلاً:** ما يُرفع يُحوَّل إلى base64 فيكبر الثلث، ويُمرَّر في
// جسم الطلب، ثم يُرسل إلى النموذج ويُحاسَب عليه. ملفٌّ بلا سقف يعني طلباً
// بلا سقف وفاتورةً بلا سقف.

export type UploadKind = "image" | "pdf" | "audio";

export const UPLOAD_LIMITS: Record<UploadKind, {
  /** الحدّ بالبايت */
  maxBytes: number;
  /** أنواع MIME المقبولة */
  mimes: readonly string[];
  /** ما يُكتب في حقل الاختيار */
  accept: string;
  /** اسمٌ عربي يظهر في الرسائل */
  label: string;
}> = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    accept: "image/*",
    label: "الصورة",
  },
  // **أقلّ من الصورة عمداً:** صفحةٌ ممسوحة ضوئياً في PDF أثقل من صورتها،
  // وقارئ المستندات يقرأ النصّ لا الحبر — فملفٌّ من عشرين صفحة يُنفق كثيراً
  // ويُخرج قليلاً.
  pdf: {
    maxBytes: 8 * 1024 * 1024,
    mimes: ["application/pdf"],
    accept: "application/pdf",
    label: "ملف PDF",
  },
  audio: {
    maxBytes: 15 * 1024 * 1024,
    mimes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"],
    accept: "audio/*",
    label: "المقطع الصوتي",
  },
};

/** ما يقبله حقل الاختيار في المحادثة: صورة أو PDF */
export const CHAT_ACCEPT = `${UPLOAD_LIMITS.image.accept},${UPLOAD_LIMITS.pdf.accept}`;

export function uploadKindOf(mimeType: string): UploadKind | null {
  const m = (mimeType || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  return null;
}

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} ميجابايت` : `${Math.round(n / 1024)} كيلوبايت`;

/**
 * يتحقّق من النوع والحجم معاً.
 *
 * **والرسالة تقول الرقمين:** «كبير جداً» وحده يجعل صاحبه يجرّب ثانيةً بملفٍّ
 * أصغر قليلاً ويُرفض ثانيةً. ذكرُ حجمه والحدّ يُنهي التخمين من أوّل مرّة.
 *
 * @returns رسالة الرفض، أو null إن كان مقبولاً
 */
export function checkUpload(mimeType: string, bytes: number): string | null {
  const kind = uploadKindOf(mimeType);
  if (!kind) return "نوع الملف غير مدعوم — ارفع صورة أو ملف PDF";
  const lim = UPLOAD_LIMITS[kind];
  if (kind !== "audio" && !lim.mimes.includes(mimeType.toLowerCase().split(";")[0])) {
    return `${lim.label}: الصيغة غير مدعومة — المدعوم ${lim.mimes.map(m => m.split("/")[1]).join("، ")}`;
  }
  if (bytes > lim.maxBytes) {
    return `${lim.label} ${formatBytes(bytes)} والحدّ الأقصى ${formatBytes(lim.maxBytes)}`;
  }
  if (bytes === 0) return `${lim.label} فارغ`;
  return null;
}
