import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Smartphone, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";

// Firebase يُحمَّل عند الحاجة فقط — لا داعي لإدخاله في الحزمة الأولى لكل زائر
async function loadFirebaseAuth() {
  const [{ initializeApp, getApps }, auth] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.projectId) throw new Error("خدمة تأكيد الجوال غير مضبوطة");
  const app = getApps()[0] ?? initializeApp(config);
  const instance = auth.getAuth(app);
  instance.languageCode = "ar";
  return { auth, instance };
}

type ConfirmationLike = { confirm: (code: string) => Promise<{ user: { getIdToken: () => Promise<string> } }> };

/**
 * رسائل Firebase تصل بالإنجليزية وبمفردات مطوّرين ("region enabled by the app
 * developer") — لا تصلح لعميل عربي لا يملك عن حسابنا شيئاً. نترجم ما يعنيه الخطأ
 * له، ونترك النص الأصلي للكونسول ليقرأه من يشغّل المنصة.
 */
function arabicAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  switch (code) {
    case "auth/invalid-phone-number":
      return "رقم الجوال غير صالح — تأكد من الرقم ورمز الدولة.";
    case "auth/missing-phone-number":
      return "أدخل رقم جوالك أولاً.";
    case "auth/too-many-requests":
      return "حاولت مرات كثيرة. انتظر قليلاً ثم أعد المحاولة.";
    case "auth/quota-exceeded":
      return "تعذّر الإرسال الآن لبلوغ حد الرسائل. سنعالجها — أبلغ الدعم إن تكررت.";
    case "auth/operation-not-allowed":
      return "إرسال الرسائل غير مفعّل لبلد هذا الرقم عندنا بعد. أبلغ الدعم بالبلد لتفعيله.";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
      return "فشل التحقق الأمني. أعد تحميل الصفحة ثم حاول مرة أخرى.";
    case "auth/unauthorized-domain":
      return "هذا الموقع غير مصرّح له بإرسال الرموز بعد. أبلغ الدعم.";
    case "auth/network-request-failed":
      return "تعذّر الاتصال بالشبكة. تحقق من اتصالك ثم أعد المحاولة.";
    default:
      return err instanceof Error && err.message ? err.message : "تعذّر إرسال الرمز";
  }
}

/**
 * وعد لا يُحسم أبداً يترك الزر يدور بلا نهاية ولا يقول للعميل شيئاً — وهي الحالة
 * التي يقع فيها Firebase حين يرفض reCAPTCHA النطاق: لا خطأ ولا استجابة. نفرض
 * حداً زمنياً حتى يفشل الأمر صراحةً ويعرف العميل أن عليه المحاولة أو إبلاغنا.
 */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * تأكيد رقم الجوال عبر Firebase.
 *
 * الإرسال والتأكيد يحدثان في المتصفح، ثم نرسل رمز الهوية للسيرفر ليتحقق من
 * توقيعه ويعتمد الرقم — لا نثق بما يقوله المتصفح عن نفسه.
 *
 * عند تعذّر الإرسال يُحفظ الرقم ويبقى غير مؤكَّد: التأكيد مؤجَّل لا متخطّى،
 * والتذكير يظل ظاهراً في لوحة التحكم حتى يتم فعلاً.
 */
export default function PhoneVerification() {
  const utils = trpc.useUtils();
  const { data: setup } = trpc.accountSetup.status.useQuery();
  const savePhone = trpc.phone.save.useMutation();
  const confirmPhone = trpc.phone.confirm.useMutation();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationLike | null>(null);
  const [busy, setBusy] = useState(false);
  const [deferred, setDeferred] = useState<string | null>(null);
  const recaptchaRef = useRef<{ clear: () => void } | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => { recaptchaRef.current?.clear(); }, []);

  /**
   * reCAPTCHA يَسِم العنصر الذي رسم نفسه فيه، ولا يزيل clear() ذلك الوسم — فأي
   * محاولة ثانية على العنصر نفسه تفشل بـ "reCAPTCHA has already been rendered in
   * this element". لذا نعطي كل محاولة عنصراً وليداً جديداً بدل إعادة استعمال واحد.
   */
  const freshRecaptchaHost = () => {
    const holder = holderRef.current;
    if (!holder) throw new Error("تعذّر تهيئة التحقق الأمني");
    holder.innerHTML = "";
    const host = document.createElement("div");
    holder.appendChild(host);
    return host;
  };

  const verified = setup?.steps.find(s => s.key === "phone")?.done ?? false;

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) { toast.error("أدخل رقم جوالك"); return; }
    setBusy(true);
    setDeferred(null);
    try {
      // نحفظ الرقم أولاً: لو فشل الإرسال لا يضيع ما كتبه العميل
      const saved = await savePhone.mutateAsync({ phone: phone.trim() });
      const { auth, instance } = await loadFirebaseAuth();
      recaptchaRef.current?.clear();
      const verifier = new auth.RecaptchaVerifier(instance, freshRecaptchaHost(), { size: "invisible" });
      recaptchaRef.current = verifier;
      const result = await withTimeout(
        auth.signInWithPhoneNumber(instance, saved.phone, verifier),
        45_000,
        "لم يستجب مزوّد التحقق. حاول مرة أخرى، وإن تكرر فأبلغ الدعم.",
      );
      setConfirmation(result as unknown as ConfirmationLike);
      toast.success("أرسلنا رمزاً إلى جوالك");
    } catch (err) {
      const msg = arabicAuthError(err);
      // reCAPTCHA يبقى في حالة نصف مكتملة بعد الفشل فلا تنجح محاولة ثانية بدونه
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
      // النص الأصلي للمشغّل: أشيع الأسباب نطاق غير مصرّح به أو بلد غير مفعّل
      console.warn("[phone] تعذّر إرسال الرمز:", err,
        "— راجع في Firebase ← Authentication ← Settings كلاً من Authorized domains وSMS region policy");
      // الرقم محفوظ بالفعل، فنسمح بالمتابعة ونُبقي التذكير ظاهراً
      setDeferred(msg);
      await utils.accountSetup.status.invalidate();
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmation || code.trim().length < 4) { toast.error("أدخل الرمز المرسل إليك"); return; }
    setBusy(true);
    try {
      const cred = await confirmation.confirm(code.trim());
      const idToken = await cred.user.getIdToken();
      await confirmPhone.mutateAsync({ idToken });
      toast.success("تم تأكيد رقم جوالك");
      setConfirmation(null);
      setCode("");
      await utils.accountSetup.status.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "رمز غير صحيح");
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        رقم جوالك مؤكَّد <span dir="ltr" className="font-mono">{setup?.phoneMasked}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* حاوية reCAPTCHA غير المرئية التي يتطلبها Firebase */}
      {/* حاوية فقط: العنصر الذي يرسم فيه reCAPTCHA يُنشأ داخلها من جديد كل محاولة */}
      <div ref={holderRef} />

      {deferred && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-amber-900">
            حفظنا رقمك لكن تعذّر إرسال الرمز الآن. يمكنك متابعة استخدام حسابك، وسيظل التذكير ظاهراً حتى تؤكّده.
            <span className="block text-[11px] opacity-70 mt-1" dir="ltr">{deferred}</span>
          </p>
        </div>
      )}

      {!confirmation ? (
        <form onSubmit={sendCode} className="space-y-2">
          <Label htmlFor="pv-phone">رقم الجوال</Label>
          <div className="flex gap-2">
            <Input
              id="pv-phone" dir="ltr" inputMode="tel" autoComplete="tel"
              placeholder="05xxxxxxxx" value={phone}
              onChange={e => setPhone(e.target.value)} disabled={busy} className="text-left"
            />
            <Button type="submit" disabled={busy || !phone.trim()} className="gap-2 shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
              أرسل الرمز
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">رقم سعودي يبدأ بـ 05، أو رقم دولي يبدأ بـ +</p>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-2">
          <Label htmlFor="pv-code">رمز التأكيد</Label>
          <div className="flex gap-2">
            <Input
              id="pv-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus
              placeholder="000000" maxLength={6} value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={busy} className="text-center tracking-[0.4em] font-mono"
            />
            <Button type="submit" disabled={busy || code.length < 4} className="gap-2 shrink-0">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              تأكيد
            </Button>
          </div>
          <button type="button" onClick={() => { setConfirmation(null); setCode(""); }}
            className="text-xs text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11">
            تغيير الرقم
          </button>
        </form>
      )}
    </div>
  );
}
