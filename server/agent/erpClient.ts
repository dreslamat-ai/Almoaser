// ─── اتصال ERPNext لكل مستخدم + عملاء HTTP ──────────────────────────────────
// AsyncLocalStorage تحمل إعداد العميل عبر سلسلة الاستدعاء بلا تمريره يدوياً في
// كل دالة. هذا هو الحد الفاصل بين نظام عميل وآخر — ووضعه في ملف واحد يجعل
// مراجعته ممكنة.
import { AsyncLocalStorage } from "async_hooks";
import { getErpConfigForUser, getErpSession, invalidateErpSession, type ErpConfig } from "../erpConnection";

// حدّ الاقتطاع للخطأ: 300 حرفاً كانت تبتر رسالة LinkExistsError عند الرابط
// الأول — رابط السجل نفسه — فيضيع الرابط الثاني الذي يسمّي المستند المانع،
// ويظلّ الوكيل يبحث عمّا لم نُرِه إياه. النص لا يُعرض خاماً للعميل:
// translateErpError يستخرج منه الرسالة البشرية.
const ERROR_KEEP = 4000;

// فتعمل كل helpers (erpGET/erpPOST/submitDoc...) على نظام المستخدم دون تمرير config يدوياً
export const erpContext = new AsyncLocalStorage<ErpConfig>();

export async function runWithErpConfig<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const config = await getErpConfigForUser(userId);
  return erpContext.run(config, fn);
}

export function currentErpConfig(): ErpConfig {
  const cfg = erpContext.getStore();
  if (cfg) return cfg;
  // fallback (لا يحدث في المسار الطبيعي): اتصال النظام الافتراضي
  return {
    url: (process.env.ERPNEXT_URL ?? "").replace(/\/+$/, ""),
    username: process.env.ERPNEXT_USERNAME ?? "",
    password: process.env.ERPNEXT_PASSWORD ?? "",
    source: "system",
    provider: "erpnext",
  };
}

export async function getSession(): Promise<string> {
  return getErpSession(currentErpConfig());
}

export function erpBaseUrl(): string {
  return currentErpConfig().url;
}

export async function erpGET(path: string): Promise<unknown> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid}` } });
  if (res.status === 401 || res.status === 403) {
    invalidateErpSession(currentErpConfig());
    const sid2 = await getSession();
    const res2 = await fetch(`${url}${path}`, { headers: { Cookie: `sid=${sid2}` } });
    if (!res2.ok) throw new Error(`ERPNext GET error ${res2.status}`);
    return res2.json();
  }
  if (!res.ok) throw new Error(`ERPNext GET error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function erpPOST(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json", "X-Frappe-CSRF-Token": "fetch" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ERPNext POST error ${res.status}: ${errText.slice(0, ERROR_KEEP)}`);
  }
  return res.json();
}

export async function erpPUT(path: string, body: Record<string, unknown>): Promise<unknown> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "PUT",
    headers: { Cookie: `sid=${sid}`, "Content-Type": "application/json", "X-Frappe-CSRF-Token": "fetch" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ERPNext PUT error ${res.status}: ${errText.slice(0, ERROR_KEEP)}`);
  }
  return res.json();
}

export async function erpDELETE(path: string): Promise<void> {
  const url = erpBaseUrl();
  const sid = await getSession();
  const res = await fetch(`${url}${path}`, {
    method: "DELETE",
    headers: { Cookie: `sid=${sid}`, "X-Frappe-CSRF-Token": "fetch" },
  });
  if (!res.ok && res.status !== 202) {
    const errText = await res.text();
    throw new Error(`ERPNext DELETE error ${res.status}: ${errText.slice(0, ERROR_KEEP)}`);
  }
}

/** إلغاء مستند معتمد (docstatus 1 → 2) عبر frappe.client.cancel */
export async function cancelDoc(doctype: string, docName: string): Promise<{ name: string; docstatus?: number }> {
  const data = await erpPOST("/api/method/frappe.client.cancel", { doctype, name: docName }) as { message?: { name: string; docstatus?: number } };
  return data?.message ?? { name: docName };
}
