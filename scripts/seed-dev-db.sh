#!/usr/bin/env bash
# نسخ بنية قاعدة الإنتاج إلى قاعدة التطوير — **بلا بيانات عملاء**.
#
# البنية وحدها ثم البيانات المرجعية (الباقات وأسعارها). لا مستخدمين ولا
# اشتراكات ولا محادثات ولا دفعات ولا عملاء محتملين: بيئة التطوير يُجرَّب فيها
# الحذف والتعديل، ونسخُ بيانات عملاء حقيقيين إليها ينقل الخطر بدل أن يعزله —
# ويضاعف أماكن تسرّبها.
set -euo pipefail

DEV_DIR=/home/eipsys/work/almoaser-dev
PROD_ENV=/home/almoaser-ai/apps/almoaser-ai/.env

read_url () {  # ملف، اسم المتغيّر → مكوّنات الاتصال
  node -e '
  const fs=require("fs");
  for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){
    const i=l.indexOf("="); if(i<1) continue;
    if(l.slice(0,i).trim()!=="DATABASE_URL") continue;
    const v=l.slice(i+1).trim(); if(!v) process.exit(1);
    const u=new URL(v);
    const q=s=>"'"'"'"+String(s).replace(/'"'"'/g,"'"'"'\\'"'"''"'"'")+"'"'"'";
    console.log(`H=${q(u.hostname)}; P=${q(u.port||3306)}; U=${q(decodeURIComponent(u.username))}; W=${q(decodeURIComponent(u.password))}; D=${q(u.pathname.slice(1))}`);
  }' "$1"
}

eval "$(read_url "$PROD_ENV")"; PH=$H PP=$P PU=$U PW=$W PD=$D
eval "$(read_url "$DEV_DIR/.env")" || { echo "✗ DATABASE_URL غير مضبوط في بيئة التطوير — اقرأ DEV-SETUP.md"; exit 1; }

[ "$D" != "$PD" ] || { echo "✗ قاعدة التطوير هي نفسها قاعدة الإنتاج — أُلغي"; exit 1; }
echo "▶ من $PD إلى $D"

# كلمة المرور في ملف لا في سطر الأوامر: الوسائط يقرأها أي مستخدم عبر ps
mk_cnf () { local f; f=$(mktemp); chmod 600 "$f"; printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$1" "$2" "$3" "$4" > "$f"; echo "$f"; }
PC=$(mk_cnf "$PH" "$PP" "$PU" "$PW"); DC=$(mk_cnf "$H" "$P" "$U" "$W")
trap 'rm -f "$PC" "$DC"' EXIT

echo "▶ نسخ البنية (بلا بيانات)"
mysqldump --defaults-extra-file="$PC" --no-data --routines --triggers --events \
  --default-character-set=utf8mb4 "$PD" | mysql --defaults-extra-file="$DC" "$D"

# البيانات المرجعية فقط — ما لا يخص عميلاً بعينه
for t in plans plan_prices; do
  if mysql --defaults-extra-file="$PC" -N -e "show tables like '$t'" "$PD" | grep -q .; then
    echo "▶ نسخ بيانات $t"
    mysqldump --defaults-extra-file="$PC" --no-create-info --default-character-set=utf8mb4 "$PD" "$t" \
      | mysql --defaults-extra-file="$DC" "$D"
  fi
done

echo "✓ جاهزة. الجداول: $(mysql --defaults-extra-file="$DC" -N -e 'select count(*) from information_schema.tables where table_schema=database()' "$D")"
echo "  ولا صف واحد من بيانات العملاء."
