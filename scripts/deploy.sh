#!/usr/bin/env bash
#
# نشر بلا انقطاع للأصول.
#
# البناء المباشر في dist/public كان يقطع الخدمة: emptyOutDir يفرّغ المجلد أولاً
# وpm2 يظل يخدم منه، فطوال مدة البناء تغيب كل الملفات المبنية عن كل عميل فاتح
# التطبيق — لا عن الناشر وحده. والشِنَك المحمَّلة عند الحاجة (Firebase مثلاً)
# تفشل حينها بـ "Importing a module script failed".
#
# هنا يُبنى كل إصدار في مجلد خاص به، ولا يُستبدل الرابط الرمزي dist/public إلا
# بعد نجاح البناء كاملاً — والاستبدال نفسه عملية rename ذرّية، فلا توجد لحظة
# يرى فيها العميل مجلداً نصف جاهز. وإذا فشل البناء بقي الإصدار الحالي يخدم كما هو.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$(pwd)

RELEASES="$ROOT/dist/releases"
LIVE="$ROOT/dist/public"
KEEP=3                      # نُبقي إصدارات سابقة للتراجع الفوري عند الحاجة
STAMP=$(date +%Y%m%d-%H%M%S)
NEW="$RELEASES/$STAMP"

# vite build لا يفحص الأنواع: نشرتُ مرة كوداً فيه خطأ نوع لأن البناء نجح.
# الفحص هنا يوقف النشر قبل أن يصل الخطأ للعملاء، لا بعده.
echo "▶ فحص الأنواع"
npx tsc --noEmit || { echo "✗ فحص الأنواع فشل — أُلغي النشر ولم يتغيّر الإصدار الحيّ"; exit 1; }

# ─── بوابة الاختبارات ─────────────────────────────────────────────────────────
# فحص الأنواع يمسك الأخطاء الشكلية وحدها. سلوك خاطئ يمرّ منه سليماً، ولهذا
# تُشغَّل الاختبارات قبل النشر لا بعده.
#
# **الاستثناء الوحيد** erpnext.test.ts: يتصل بخادم ERPNext حيّ، فيفشل حين يكون
# الخادم مطفأً أو الشبكة محجوبة — أي لأسباب لا علاقة لها بالكود المنشور. يُشغَّل
# يدوياً: npx vitest run server/erpnext.test.ts
#
# الحد الأدنى للعدد يمنع الثغرة الصامتة: لو كسر خطأٌ في الإعداد جمعَ الملفات
# لمرّت البوابة على صفر اختبار وهي "ناجحة". العدد يرتفع مع نمو المشروع؛ إن
# انخفض فقد اختفت اختبارات ويجب معرفة السبب لا خفض الرقم.
MIN_TESTS=300
echo "▶ الاختبارات"
TEST_LOG=$(mktemp)
if ! npx vitest run --exclude 'server/erpnext.test.ts' --reporter=dot > "$TEST_LOG" 2>&1; then
  tail -30 "$TEST_LOG"
  echo "✗ الاختبارات فشلت — أُلغي النشر ولم يتغيّر الإصدار الحيّ"
  rm -f "$TEST_LOG"; exit 1
fi
PASSED=$(grep -oE 'Tests +[0-9]+ passed' "$TEST_LOG" | grep -oE '[0-9]+' | head -1)
rm -f "$TEST_LOG"
if [ -z "$PASSED" ] || [ "$PASSED" -lt "$MIN_TESTS" ]; then
  echo "✗ نجح $PASSED اختباراً فقط والمتوقع $MIN_TESTS على الأقل — يُرجَّح أن ملفات لم تُجمَع. أُلغي النشر"
  exit 1
fi
echo "  ✓ $PASSED اختباراً"

# ─── بوّابة الفريق ────────────────────────────────────────────────────────────
# **يُختبَر الفاحص قبل أن يُوثق به.** فحصٌ كُتب خطأً فلا يمسك شيئاً يبدو في
# التقرير نظيفاً تماماً — وقد أثبت هذا الوضع خمسة فحوصٍ عاجزة أوّل تشغيلة.
# لا يفحص هذا الكودَ المنشور بل أدوات فحصه، فيُوقف النشر لأن ما بعده سيمرّ
# على عمياء.
echo "▶ اختبار فريق المراجعة الذاتي"
npx tsx scripts/review-crew.mts --self-test > /dev/null 2>&1 \
  || { npx tsx scripts/review-crew.mts --self-test; echo "✗ فحوص الفريق لا تمسك ما وُضعت له — أُلغي النشر"; exit 1; }
echo "  ✓ الفريق يُنذر حين يجب"

echo "▶ البناء إلى $NEW"
mkdir -p "$RELEASES"
SERVER_BEFORE=$(sha256sum "$ROOT/dist/index.js" 2>/dev/null | cut -d' ' -f1 || true)
CLIENT_OUT_DIR="$NEW" npx vite build
npx esbuild server/_core/index.ts --platform=node --packages=external \
  --bundle --format=esm --outdir="$ROOT/dist"
SERVER_AFTER=$(sha256sum "$ROOT/dist/index.js" | cut -d' ' -f1)

# فحص سلامة قبل التبديل: بناء ناقص أسوأ من بناء متأخر
test -s "$NEW/index.html"     || { echo "✗ index.html مفقود"; exit 1; }
test -d "$NEW/assets"         || { echo "✗ مجلد assets مفقود"; exit 1; }
test -s "$ROOT/dist/index.js" || { echo "✗ حزمة السيرفر مفقودة"; exit 1; }

# كل ملف يطلبه index.html يجب أن يكون موجوداً فعلاً — يمسك بناءً بُتر في منتصفه.
# نقرأ عبر process substitution لا عبر أنبوب: الأنبوب يضع الحلقة في صدفة فرعية
# فلا يخرج منها exit بالسكربت كله، وتمر أخطاء بصمت.
missing=0
while read -r a; do
  [ -s "$NEW/$a" ] || { echo "✗ الأصل المشار إليه مفقود: $a"; missing=1; }
done < <(grep -oE 'assets/[A-Za-z0-9._-]+\.(js|css)' "$NEW/index.html" | sort -u)
[ "$missing" -eq 0 ] || exit 1

echo "▶ تبديل $LIVE ← $STAMP"
if [ -L "$LIVE" ] || [ ! -e "$LIVE" ]; then
  # المسار الاعتيادي: استبدال رابط برابط، وmv -T عملية ذرّية
  ln -sfn "releases/$STAMP" "$LIVE.tmp"
  mv -Tf "$LIVE.tmp" "$LIVE"
else
  # أول مرة فقط: dist/public لا يزال مجلداً حقيقياً. نزيحه ولا نحذفه — هذه هي
  # الخطوة الوحيدة غير الذرّية في السكربت، والإزاحة تجعل التراجع عنها نسخاً عكسياً.
  echo "  (تحويل مجلد حقيقي إلى رابط رمزي — يحدث مرة واحدة)"
  mv "$LIVE" "$ROOT/dist/public.pre-symlink"
  ln -sfn "releases/$STAMP" "$LIVE"
  echo "  المجلد السابق محفوظ في dist/public.pre-symlink — احذفه متى اطمأننت"
fi

# إعادة التشغيل هي الانقطاع الوحيد المتبقي (~ثانيتان يردّ فيها nginx بـ 502
# لتعذّر الوصول إلى Node). لا داعي لها إن لم تتغير حزمة السيرفر: الأصول
# يخدمها الرابط الرمزي الذي بُدّل للتوّ، وexpress.static يتبعه عند كل طلب.
# فنشرٌ يمسّ الواجهة وحدها يمرّ بلا انقطاع إطلاقاً.
if [ "$SERVER_BEFORE" = "$SERVER_AFTER" ]; then
  echo "▶ حزمة السيرفر لم تتغير — لا إعادة تشغيل (نشر بلا انقطاع)"
else
  echo "▶ إعادة التشغيل (تغيّرت حزمة السيرفر)"
  if command -v almoaser >/dev/null 2>&1; then
    almoaser restart >/dev/null
  else
    pm2 restart almoaser-ai --update-env >/dev/null
  fi
fi

# التقليم بعد التبديل فقط، وبعد استبعاد الإصدار الحيّ مهما حدث
ls -1d "$RELEASES"/*/ 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  [ "$(basename "$old")" = "$STAMP" ] && continue
  echo "▶ حذف إصدار قديم: $(basename "$old")"
  rm -rf "$old"
done

echo "✓ تم النشر: $STAMP"
