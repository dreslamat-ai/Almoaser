// ─── استخراج أزرار الإجابات السريعة من رد الوكيل ─────────────────────────────
// الوكيل يُنهي أسئلته بسطر: [QUICK_REPLIES: خيار 1 | خيار 2 | ...]
// نستخرج الخيارات ونحذف السطر من النص المعروض للمستخدم
export function extractQuickReplies(raw: string): { text: string; quickReplies: string[] } {
  if (!raw) return { text: raw, quickReplies: [] };
  const regex = /\[QUICK_REPLIES:\s*([^\]]+)\]/gi;
  let quickReplies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    quickReplies = match[1]
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, 6);
  }
  const text = raw.replace(/\s*\[QUICK_REPLIES:[^\]]*\]\s*/gi, "\n").trim();
  return { text, quickReplies };
}
