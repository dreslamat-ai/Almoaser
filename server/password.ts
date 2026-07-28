// تجزئة كلمات المرور المحلية (scrypt) — تُستخدم فقط للمستخدمين الفرعيين
// الذين لا يملكون حساب ERPNext خاص بهم (مالك الحساب يسجّل عبر بيانات ERPNext مباشرة)
import crypto from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, KEY_LENGTH);
  return `${salt.toString("base64")}:${derived.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(plain, salt, KEY_LENGTH);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
