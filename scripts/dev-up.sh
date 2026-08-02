#!/usr/bin/env bash
# تشغيل بيئة التطوير على المنفذ 3001 تحت pm2 الخاص بمستخدم eipsys.
#
# منفصلة عن الإنتاج في كل شيء: مجلد آخر، عملية أخرى، منفذ آخر، **وقاعدة بيانات
# أخرى**. الأخيرة هي التي تجعل البيئة بيئةً لا نسخةً من الشاشة: تطويرٌ يكتب في
# قاعدة الإنتاج ليس تطويراً بل مخاطرةً بمظهر أمان.
set -euo pipefail

DEV_DIR=/home/eipsys/work/almoaser-dev
cd "$DEV_DIR"

# ─── حارس: لا تُشغَّل البيئة على قاعدة الإنتاج ───
PROD_DB=$(node -e '
const fs=require("fs");
const t=fs.readFileSync("/home/almoaser-ai/apps/almoaser-ai/.env","utf8");
for(const l of t.split("\n")){const i=l.indexOf("=");if(i>0&&l.slice(0,i).trim()==="DATABASE_URL"){
  try{console.log(new URL(l.slice(i+1).trim()).pathname.slice(1));}catch{}}}' 2>/dev/null || true)
DEV_DB=$(node -e '
const fs=require("fs");
const t=fs.readFileSync(".env","utf8");
for(const l of t.split("\n")){const i=l.indexOf("=");if(i>0&&l.slice(0,i).trim()==="DATABASE_URL"){
  const v=l.slice(i+1).trim(); if(!v)process.exit(0);
  try{console.log(new URL(v).pathname.slice(1));}catch{}}}' 2>/dev/null || true)

if [ -z "$DEV_DB" ]; then
  echo "✗ DATABASE_URL فارغ في بيئة التطوير — اقرأ DEV-SETUP.md لإنشاء قاعدة منفصلة"
  exit 1
fi
if [ "$DEV_DB" = "$PROD_DB" ]; then
  echo "✗ بيئة التطوير تشير إلى قاعدة الإنتاج ($PROD_DB) — أُلغي التشغيل"
  echo "  التطوير الذي يكتب في بيانات العملاء ليس تطويراً."
  exit 1
fi
echo "▶ قاعدة التطوير: $DEV_DB   (الإنتاج: $PROD_DB)"

[ -d node_modules ] || { echo "▶ تثبيت الحزم"; pnpm install --frozen-lockfile 2>&1 | tail -3; }

echo "▶ فحص الأنواع"
npx tsc --noEmit || { echo "✗ فحص الأنواع فشل"; exit 1; }

echo "▶ البناء"
# المسار الأساسي يُمرَّر للبناء: الواجهة تُخدَم تحت /dev على نفس النطاق، فلو
# بُنيت على الجذر طلبت أصولها من /assets فحمّلت أصول الإنتاج فوق كود التطوير.
VITE_BASE_PATH=${DEV_BASE_PATH:-/dev/} npx vite build --logLevel warn
npx esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

if pm2 describe almoaser-dev >/dev/null 2>&1; then
  pm2 restart almoaser-dev --update-env >/dev/null
  echo "✓ أُعيد تشغيل بيئة التطوير"
else
  pm2 start dist/index.js --name almoaser-dev --cwd "$DEV_DIR" >/dev/null
  pm2 save >/dev/null 2>&1 || true
  echo "✓ بدأت بيئة التطوير"
fi

sleep 2
curl -s -o /dev/null -w "  محلياً : HTTP %{http_code} على 127.0.0.1:3001\n" http://127.0.0.1:3001/ || true
curl -s -o /dev/null -w "  عام    : HTTP %{http_code} على https://erpsys.cloud/dev/\n" https://erpsys.cloud/dev/ || true
