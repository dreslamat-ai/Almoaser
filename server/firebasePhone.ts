// ─── التحقق من رمز هوية Firebase (تأكيد رقم الجوال) ──────────────────────────
// التأكيد يتم في المتصفح عبر Firebase، ويعود لنا برمز هوية موقّع. لا نثق به
// كما هو: نتحقق من توقيعه ومُصدِره وجمهوره على السيرفر قبل اعتماد الرقم.
//
// لا نستخدم firebase-admin عمداً: رمز الهوية هو JWT بخوارزمية RS256، ومفاتيح
// Google العامة متاحة للجميع، فـ jose (الموجودة أصلاً للجلسات) تكفي — بلا حزمة
// جديدة على السيرفر وبلا ملف حساب خدمة يمكن تسريبه.
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

export function getFirebaseProjectId(): string {
  return process.env.VITE_FIREBASE_PROJECT_ID ?? "";
}

export function isPhoneVerificationConfigured(): boolean {
  return Boolean(getFirebaseProjectId() && process.env.VITE_FIREBASE_API_KEY);
}

export type VerifiedPhoneToken = { ok: true; phone: string; uid: string } | { ok: false; error: string };

/**
 * يتحقق من رمز هوية Firebase ويعيد رقم الجوال المؤكَّد بداخله.
 * يرفض أي رمز لا يحمل رقم جوال — رمز صادر عن تسجيل دخول بطريقة أخرى
 * (Google مثلاً) لا يثبت ملكية رقم.
 */
export async function verifyFirebasePhoneToken(idToken: string): Promise<VerifiedPhoneToken> {
  const projectId = getFirebaseProjectId();
  if (!projectId) return { ok: false, error: "خدمة تأكيد الجوال غير مضبوطة" };
  if (!idToken || idToken.length < 20) return { ok: false, error: "رمز التحقق غير صالح" };

  try {
    const { payload } = await jwtVerify(idToken, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });

    // auth_time يجب أن يكون في الماضي؛ jose يتحقق من exp/iat تلقائياً
    const phone = typeof payload.phone_number === "string" ? payload.phone_number : "";
    if (!phone) return { ok: false, error: "هذا الرمز لا يثبت ملكية رقم جوال" };

    const uid = typeof payload.user_id === "string" ? payload.user_id : String(payload.sub ?? "");
    if (!uid) return { ok: false, error: "رمز التحقق ناقص" };

    return { ok: true, phone, uid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[firebasePhone] token verification failed:", msg);
    if (/exp|expired/i.test(msg)) return { ok: false, error: "انتهت صلاحية رمز التحقق — أعد المحاولة" };
    return { ok: false, error: "تعذّر التحقق من الرمز" };
  }
}
