import { Button } from "@/components/ui/button";
import { Compass, Home } from "lucide-react";
import { Link } from "wouter";

/**
 * الصفحة المفقودة.
 *
 * كانت **بالإنجليزية وحدها** ("Page Not Found" / "Go Home") داخل واجهة عربية
 * كاملة الاتجاه، بأزرق `blue-600` ورمادي `slate` لا وجود لهما في الهوية، وبهامش
 * `mr-2` فيزيائي يقع في الجهة الخطأ في RTL. أي زائر يصلها كان يرى فجأة منتجاً
 * آخر — وهي الشاشة التي يصلها من ضلّ الطريق أصلاً.
 */
export default function NotFound() {
  return (
    <div className="auth-shell" dir="rtl">
      <div className="auth-card max-w-md text-center">
        <div className="m-icon m-icon--lg mx-auto mb-6">
          <Compass className="w-7 h-7" />
        </div>

        <p className="m-eyebrow">خطأ 404</p>
        <h1 className="text-2xl font-bold text-navy tracking-tight mb-3">هذه الصفحة غير موجودة</h1>

        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          الرابط الذي فتحته لم يعد موجوداً، أو نُقل إلى موضع آخر.
          تفقّد العنوان، أو ارجع إلى الصفحة الرئيسية وابدأ من هناك.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Link href="/" className="flex-1">
            <Button className="w-full h-12 gap-2 font-semibold">
              <Home className="w-4 h-4" />
              الصفحة الرئيسية
            </Button>
          </Link>
          <Link href="/erp" className="flex-1">
            <Button variant="outline" className="w-full h-12 border-navy/25 text-navy">
              لوحة التحكم
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
