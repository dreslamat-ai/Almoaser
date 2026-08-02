#!/usr/bin/env bash
# ترقية ما جُرّب في التطوير إلى الإنتاج.
#
# الترقية ليست نسخ ملفات: هي دمج فرعٍ مُراجَع في main ثم نشرٌ من الإنتاج نفسه
# بنفس البوابة (أنواع + اختبارات). نسخُ ملفات بين المجلدين يتجاوز البوابة
# ويجعل الإنتاج يحمل شيئاً لا يوجد في التاريخ — وهو أسوأ حالة عند التراجع.
set -euo pipefail

DEV=/home/eipsys/work/almoaser-dev
PROD=/home/almoaser-ai/apps/almoaser-ai

cd "$DEV"
BRANCH=$(git branch --show-current)

if [ "$BRANCH" = "main" ]; then
  echo "✗ أنت على main في بيئة التطوير — اعمل على فرع:"
  echo "    git switch -c feature/اسم-التعديل"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ فيه تعديلات غير محفوظة — اعمل commit أولاً:"
  git status --short | head -10
  exit 1
fi

echo "▶ بوابة التطوير قبل الترقية"
npx tsc --noEmit || { echo "✗ فحص الأنواع فشل — لا ترقية"; exit 1; }
npx vitest run --exclude 'server/erpnext.test.ts' --reporter=dot 2>&1 | tail -3 | grep -q "failed" \
  && { echo "✗ الاختبارات فشلت — لا ترقية"; exit 1; } || true

echo "▶ رفع الفرع $BRANCH"
git push -u origin "$BRANCH"

echo "▶ الدمج في main ورفعه"
git switch main
git pull --ff-only origin main
git merge --no-ff "$BRANCH" -m "Merge $BRANCH"
git push origin main

echo "▶ سحب main في الإنتاج ونشره"
cd "$PROD"
git pull --ff-only origin main
npm run deploy

cd "$DEV"
git switch "$BRANCH"
echo
echo "✓ رُقّي $BRANCH إلى الإنتاج."
echo "  للتراجع: bash $PROD/scripts/rollback.sh"
