import { useState, useEffect } from "react";
import { Download, Share, PlusSquare, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// حدث beforeinstallprompt غير موجود في أنواع TypeScript القياسية
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// نلتقط الحدث مبكراً على مستوى الوحدة لأنه قد يُطلق قبل تركيب المكوّن
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    promptListeners.forEach((fn) => fn());
  });
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // سفاري iOS
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS الحديث يتنكر كـ Mac
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1)
  );
}

/**
 * زر "ثبّت التطبيق" في قوائم التنقل.
 * - كروم/أندرويد/إيدج: يستدعي نافذة التثبيت الأصلية عبر beforeinstallprompt
 * - سفاري/iOS: يعرض تعليمات (مشاركة ← إضافة إلى الشاشة الرئيسية)
 * - يختفي تلقائياً إذا كان التطبيق يعمل مثبتاً (standalone)
 */
export function InstallAppButton({ className }: { className?: string }) {
  const [installed, setInstalled] = useState(isStandalone());
  const [canPrompt, setCanPrompt] = useState(deferredPrompt !== null);
  const [showIosDialog, setShowIosDialog] = useState(false);

  useEffect(() => {
    const update = () => {
      setCanPrompt(deferredPrompt !== null);
      if (isStandalone()) setInstalled(true);
    };
    promptListeners.add(update);
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMq = () => setInstalled(isStandalone());
    mq.addEventListener?.("change", onMq);
    return () => {
      promptListeners.delete(update);
      mq.removeEventListener?.("change", onMq);
    };
  }, []);

  // مثبت بالفعل — لا داعي للزر
  if (installed) return null;

  const ios = isIOS();
  // متصفح لا يدعم التثبيت إطلاقاً (لا prompt ولا iOS) — نعرض تعليمات عامة أيضاً
  const handleClick = async () => {
    if (deferredPrompt) {
      const p = deferredPrompt;
      await p.prompt();
      const choice = await p.userChoice;
      if (choice.outcome === "accepted") {
        deferredPrompt = null;
        setInstalled(true);
      }
      return;
    }
    // iOS أو متصفح بدون دعم الحدث — نعرض التعليمات
    setShowIosDialog(true);
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={
          className ??
          "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-gold hover:bg-white/10 transition-all"
        }
      >
        <Download className="w-5 h-5" />
        ثبّت التطبيق
      </button>

      <Dialog open={showIosDialog} onOpenChange={setShowIosDialog}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              تثبيت التطبيق على جهازك
            </DialogTitle>
            <DialogDescription className="sr-only">
              خطوات تثبيت التطبيق على الشاشة الرئيسية
            </DialogDescription>
          </DialogHeader>
          {ios ? (
            <ol className="space-y-4 text-sm leading-relaxed">
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
                <span>
                  اضغط زر <strong>المشاركة</strong>
                  <Share className="inline w-4 h-4 mx-1 align-text-bottom" />
                  في شريط سفاري السفلي
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
                <span>
                  اختر <strong>"إضافة إلى الشاشة الرئيسية"</strong>
                  <PlusSquare className="inline w-4 h-4 mx-1 align-text-bottom" />
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
                <span>اضغط <strong>"إضافة"</strong> — وستجد أيقونة التطبيق على شاشتك الرئيسية</span>
              </li>
            </ol>
          ) : (
            <div className="space-y-3 text-sm leading-relaxed">
              <p>لتثبيت التطبيق من متصفحك:</p>
              <ul className="space-y-2 list-disc pr-5">
                <li><strong>كروم / إيدج:</strong> افتح قائمة المتصفح (⋮) واختر <strong>"تثبيت التطبيق"</strong> أو "إضافة إلى الشاشة الرئيسية"</li>
                <li><strong>سامسونج إنترنت:</strong> القائمة ← "إضافة الصفحة إلى" ← الشاشة الرئيسية</li>
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
