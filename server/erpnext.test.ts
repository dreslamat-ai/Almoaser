import { describe, it, expect } from "vitest";

const ERPNEXT_URL = process.env.ERPNEXT_URL ?? "https://demo.almoaser.cloud";
const ERPNEXT_USERNAME = process.env.ERPNEXT_USERNAME ?? "egcwebhost@gmail.com";
const ERPNEXT_PASSWORD = process.env.ERPNEXT_PASSWORD ?? "";

async function getSession(): Promise<string | null> {
  const loginRes = await fetch(`${ERPNEXT_URL}/api/method/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr: ERPNEXT_USERNAME, pwd: ERPNEXT_PASSWORD }),
  });

  if (!loginRes.ok) return null;

  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const sidMatch = setCookie.match(/sid=([^;]+)/);
  if (!sidMatch || sidMatch[1] === "Guest") return null;

  return sidMatch[1];
}

describe("ERPNext Connection", () => {
  it("should login successfully and get a valid session", async () => {
    const sid = await getSession();
    expect(sid).toBeTruthy();
    expect(sid).not.toBe("Guest");
  }, 15000);

  it("should fetch company list", async () => {
    const sid = await getSession();
    expect(sid).toBeTruthy();

    const res = await fetch(`${ERPNEXT_URL}/api/resource/Company?limit=5`, {
      headers: { Cookie: `sid=${sid}` },
    });
    expect(res.ok).toBe(true);

    const data = await res.json() as { data: Array<{ name: string }> };
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0].name).toBeTruthy();
  }, 20000);

  it("should fetch accounts list", async () => {
    const sid = await getSession();
    expect(sid).toBeTruthy();

    const res = await fetch(`${ERPNEXT_URL}/api/resource/Account?limit=10`, {
      headers: { Cookie: `sid=${sid}` },
    });
    expect(res.ok).toBe(true);

    const data = await res.json() as { data: unknown[] };
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
  }, 20000);

  it("should fetch items list", async () => {
    const sid = await getSession();
    expect(sid).toBeTruthy();

    const res = await fetch(`${ERPNEXT_URL}/api/resource/Item?limit=10`, {
      headers: { Cookie: `sid=${sid}` },
    });
    expect(res.ok).toBe(true);

    const data = await res.json() as { data: unknown[] };
    expect(Array.isArray(data.data)).toBe(true);
  }, 20000);
});
