#!/usr/bin/env bash
#
# الرجوع إلى الإصدار السابق فوراً، بلا إعادة بناء.
#
# البناء يستغرق دقيقة تقريباً؛ عند وقوع خطأ في الإنتاج تكون هذه الدقيقة هي
# المشكلة. الإصدارات السابقة محفوظة على القرص أصلاً، فالرجوع تبديل رابط لا أكثر.
#
# الاستخدام: scripts/rollback.sh [اسم-الإصدار]
#            بلا وسيط يرجع إلى الإصدار الذي يسبق الحيّ مباشرة.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$(pwd)
RELEASES="$ROOT/dist/releases"
LIVE="$ROOT/dist/public"

[ -d "$RELEASES" ] || { echo "✗ لا توجد إصدارات محفوظة"; exit 1; }
[ -L "$LIVE" ] || { echo "✗ $LIVE ليس رابطاً رمزياً — انشر مرة عبر scripts/deploy.sh أولاً"; exit 1; }

CURRENT=$(basename "$(readlink "$LIVE")")

if [ $# -ge 1 ]; then
  TARGET=$1
else
  # أحدث إصدار غير الحيّ. الأسماء طوابع زمنية فترتيبها النصّي هو ترتيبها الزمني.
  TARGET=$(ls -1 "$RELEASES" | sort -r | grep -v "^$CURRENT$" | head -1 || true)
fi

[ -n "${TARGET:-}" ] || { echo "✗ لا يوجد إصدار سابق للرجوع إليه"; exit 1; }
[ -s "$RELEASES/$TARGET/index.html" ] || { echo "✗ الإصدار $TARGET غير صالح أو غير موجود"; exit 1; }

echo "▶ الرجوع: $CURRENT ← $TARGET"
ln -sfn "releases/$TARGET" "$LIVE.tmp"
mv -Tf "$LIVE.tmp" "$LIVE"

# لا إعادة تشغيل: لم يتغير سوى الرابط الرمزي، وexpress.static يتبعه عند كل طلب.
# إعادة التشغيل هنا كانت ستضيف ثانيتي 502 بلا أي مقابل.

echo "✓ الإصدار الحيّ الآن: $TARGET (فوري، بلا انقطاع)"
echo "  ملاحظة: هذا يرجع الملفات المبنية فقط. حزمة السيرفر dist/index.js لم تتغير،"
echo "  فإن كان الخلل في كود السيرفر فالرجوع الحقيقي هو git + scripts/deploy.sh."
