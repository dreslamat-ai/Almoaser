// ─── نماذج الطباعة: قراءة النموذج الافتراضي المضبوط في نظام العميل ──────────
import { erpGET, erpBaseUrl } from "./erpClient";

// ERPNext يخزّن النموذج الافتراضي لكل DocType في Property Setter (وهو ما تكتبه
// واجهة "Print Settings / Default Print Format")، وأحياناً في حقل على DocType نفسه.
// نقرأه صراحةً ونطبع به بالاسم، بدل الاعتماد على استنتاج ERPNext الضمني.
export const printFormatCache = new Map<string, { candidates: Array<string | undefined>; expiry: number }>();
export const PRINT_FORMAT_CACHE_TTL = 10 * 60 * 1000;

export async function resolvePrintFormatCandidates(doctype: string): Promise<Array<string | undefined>> {
  const cacheKey = `${erpBaseUrl()}|${doctype}`;
  const cached = printFormatCache.get(cacheKey);
  if (cached && Date.now() < cached.expiry) return cached.candidates;

  const ordered: Array<string | undefined> = [];
  const push = (v?: string | null) => {
    if (v && !ordered.includes(v)) ordered.push(v);
  };

  try {
    // 1) النموذج الافتراضي الذي ضبطه العميل من إعدادات الـ DocType
    const psFilters = encodeURIComponent(JSON.stringify([["doc_type", "=", doctype], ["property", "=", "default_print_format"]]));
    const ps = await erpGET(`/api/resource/Property%20Setter?filters=${psFilters}&fields=${encodeURIComponent(JSON.stringify(["value"]))}&limit=1`) as { data?: Array<{ value?: string }> };
    push(ps?.data?.[0]?.value);
  } catch (e) {
    console.warn("[printFormat] Property Setter lookup failed:", e instanceof Error ? e.message : e);
  }

  try {
    // 2) الحقل default_print_format على الـ DocType نفسه (بعض التنصيبات تضبطه هنا)
    const dt = await erpGET(`/api/resource/DocType/${encodeURIComponent(doctype)}`) as { data?: { default_print_format?: string } };
    push(dt?.data?.default_print_format);
  } catch { /* غير حرج */ }

  try {
    // 3) بدائل مناسبة من نماذج الطباعة المتاحة لنفس الـ DocType — نفضّل الأقرب
    //    اسماً للـ DocType (مثل "Sales Invoice Print") ونستبعد نماذج الطباعة الخام (raw)
    const pfFilters = encodeURIComponent(JSON.stringify([["doc_type", "=", doctype], ["disabled", "=", 0], ["raw_printing", "=", 0]]));
    const pfFields = encodeURIComponent(JSON.stringify(["name", "print_format_type"]));
    const pf = await erpGET(`/api/resource/Print%20Format?filters=${pfFilters}&fields=${pfFields}&limit=50`) as { data?: Array<{ name: string; print_format_type?: string }> };
    const usable = (pf?.data ?? []).filter(f => f.print_format_type !== "JS");
    for (const f of usable.filter(f => f.name.startsWith(doctype))) push(f.name);
    for (const f of usable) push(f.name);
  } catch (e) {
    console.warn("[printFormat] Print Format list lookup failed:", e instanceof Error ? e.message : e);
  }

  // 4) آخر الحلول: نموذج "Standard" المتوفر في كل تنصيب ERPNext
  push("Standard");

  printFormatCache.set(cacheKey, { candidates: ordered, expiry: Date.now() + PRINT_FORMAT_CACHE_TTL });
  return ordered;
}
