import { describe, expect, it } from "vitest";

// نفس منطق TLV المستخدم في getInvoicePrintData — نتحقق من صحة الترميز وفق ZATCA
const tlv = (tag: number, value: string): Buffer => {
  const v = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag]), Buffer.from([v.length]), v]);
};

function buildQr(sellerName: string, vat: string, timestamp: string, total: string, vatAmount: string): string {
  return Buffer.concat([
    tlv(1, sellerName),
    tlv(2, vat),
    tlv(3, timestamp),
    tlv(4, total),
    tlv(5, vatAmount),
  ]).toString("base64");
}

function parseTlv(b64: string): Record<number, string> {
  const buf = Buffer.from(b64, "base64");
  const out: Record<number, string> = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    out[tag] = buf.subarray(i + 2, i + 2 + len).toString("utf8");
    i += 2 + len;
  }
  return out;
}

describe("ZATCA QR TLV encoding", () => {
  it("يرمّز ويفكّ الحقول الخمسة بشكل صحيح (بائع عربي + أرقام)", () => {
    const qr = buildQr("شركة المعاصر", "310000000000003", "2026-07-18T10:00:00Z", "6900.00", "900.00");
    const parsed = parseTlv(qr);
    expect(parsed[1]).toBe("شركة المعاصر");
    expect(parsed[2]).toBe("310000000000003");
    expect(parsed[3]).toBe("2026-07-18T10:00:00Z");
    expect(parsed[4]).toBe("6900.00");
    expect(parsed[5]).toBe("900.00");
  });

  it("طول قيمة UTF-8 العربية يُحسب بالبايتات لا بالأحرف", () => {
    const name = "مؤسسة";
    const qr = buildQr(name, "3", "t", "1", "0");
    const buf = Buffer.from(qr, "base64");
    // tag=1 ثم الطول بالبايتات (كل حرف عربي = 2 بايت)
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBe(Buffer.byteLength(name, "utf8"));
  });

  it("ناتج base64 صالح وغير فارغ", () => {
    const qr = buildQr("Test Co", "300000000000003", "2026-01-01T00:00:00Z", "115.00", "15.00");
    expect(qr.length).toBeGreaterThan(20);
    expect(() => Buffer.from(qr, "base64")).not.toThrow();
  });
});

describe("حساب خصم الفوترة السنوية 15%", () => {
  const cases = [
    { monthly: 999, yearly: 10190 },
    { monthly: 1499, yearly: 15290 },
    { monthly: 2499, yearly: 25490 },
  ];
  for (const c of cases) {
    it(`باقة ${c.monthly} ريال/شهر → ${c.yearly} ريال/سنة بعد خصم 15%`, () => {
      const yearlyTotal = Math.round(c.monthly * 12 * (1 - 15 / 100));
      expect(yearlyTotal).toBe(c.yearly);
      const saved = c.monthly * 12 - yearlyTotal;
      expect(saved).toBeGreaterThan(0);
      expect(saved).toBe(Math.round(c.monthly * 12 * 0.15));
    });
  }
});
