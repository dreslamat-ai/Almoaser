#!/usr/bin/env bash
# نسخة احتياطية دورية لقاعدة بيانات المعاصر.
#
# نسخة Hestia اليومية موجودة، لكنها **نسخة واحدة على نفس القرص**: تلف لا
# يُكتشف خلال أربع وعشرين ساعة يضيع معه آخر نسخة سليمة. هذا السكربت يحتفظ
# بأسبوع، فيبقى للخطأ الصامت مهلة تُكتشف فيها.
#
# **ما زال على نفس القرص.** النسخ خارج الخادم يحتاج وجهة واعتماداً لا نملكهما
# هنا — انظر آخر الملف. هذا يقلّل خطر التلف لا خطر فقد الخادم.
set -euo pipefail

APP_DIR=/home/almoaser-ai/apps/almoaser-ai
DEST=${BACKUP_DIR:-/home/eipsys/backups/almoaser}
KEEP=${BACKUP_KEEP:-7}

command -v mysqldump >/dev/null || { echo "mysqldump غير مثبّت"; exit 1; }
[ -r "$APP_DIR/.env" ] || { echo "تعذّر قراءة .env"; exit 1; }

# DATABASE_URL يُقرأ بـnode لا بـsource: قيم .env تحوي أقواساً ومسافات تكسر bash
eval "$(node -e '
const fs=require("fs");
const t=fs.readFileSync(process.argv[1],"utf8");
for(const l of t.split("\n")){const i=l.indexOf("=");if(i<1)continue;
  if(l.slice(0,i).trim()!=="DATABASE_URL")continue;
  const u=new URL(l.slice(i+1).trim());
  const q=s=>"'"'"'"+String(s).replace(/'"'"'/g,"'"'"'\\'"'"''"'"'")+"'"'"'";
  console.log(`DB_HOST=${q(u.hostname)}; DB_PORT=${q(u.port||3306)}; DB_USER=${q(decodeURIComponent(u.username))}; DB_PASS=${q(decodeURIComponent(u.password))}; DB_NAME=${q(u.pathname.slice(1))}`);
}' "$APP_DIR/.env")"

[ -n "${DB_NAME:-}" ] || { echo "تعذّر استخراج بيانات القاعدة من DATABASE_URL"; exit 1; }

mkdir -p "$DEST"; chmod 700 "$DEST"

# كلمة المرور في ملف لا في سطر الأوامر: وسائط العمليات يقرأها أي مستخدم على
# الخادم عبر ps، وعلى هذا الجهاز أكثر من حساب بشري.
CNF=$(mktemp); chmod 600 "$CNF"
trap 'rm -f "$CNF"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASS" > "$CNF"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/almoaser-$STAMP.sql.gz"

# --single-transaction: لقطة متسقة بلا قفل الجداول، فلا يتوقف التطبيق أثناء النسخ
mysqldump --defaults-extra-file="$CNF" \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$OUT.part"

# لا يُسمّى نهائياً إلا بعد اكتماله: نسخة مقطوعة تبدو سليمة أخطر من غيابها
SIZE=$(stat -c%s "$OUT.part")
[ "$SIZE" -gt 10240 ] || { echo "النسخة أصغر من المتوقع ($SIZE بايت) — أُلغيت"; rm -f "$OUT.part"; exit 1; }
gzip -t "$OUT.part" || { echo "النسخة تالفة — أُلغيت"; rm -f "$OUT.part"; exit 1; }
mv "$OUT.part" "$OUT"; chmod 600 "$OUT"

# الحذف بعد نجاح الجديدة لا قبلها
ls -1t "$DEST"/almoaser-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "✓ $(basename "$OUT") — $(du -h "$OUT" | cut -f1) — محفوظ منها $(ls -1 "$DEST"/almoaser-*.sql.gz | wc -l)"

# ─── نسخة خارج الخادم ────────────────────────────────────────────────────────
#
# ما سبق يحمي من التلف والحذف الخاطئ لا من فقد الخادم. هذه الخطوة تعالج ذلك.
#
# **تُعمّى قبل الرفع.** الملف يحوي بيانات عملاء مالية وكلمات مرور ERP، ورفعه
# لأي تخزين يجعله في مكانين. المعمّى بمفتاح لا يوجد إلا هنا يبقى بلا قيمة حتى
# لو تسرّب التخزين — وهو الفارق بين نسخة احتياطية وتسريب مؤجَّل.
REMOTE=${BACKUP_REMOTE:-r2:almoaser-backups}
PASSFILE=${BACKUP_PASSFILE:-/home/eipsys/.config/backup-passphrase}

if command -v rclone >/dev/null 2>&1 && [ -r "$PASSFILE" ]; then
  ENC="$OUT.gpg"
  if gpg --batch --yes --symmetric --cipher-algo AES256 \
         --passphrase-file "$PASSFILE" -o "$ENC" "$OUT" 2>/dev/null; then
    chmod 600 "$ENC"
    if rclone copy "$ENC" "$REMOTE/db/" --no-traverse 2>/dev/null; then
      echo "  ↑ رُفعت معمّاة إلى $REMOTE/db/"
      # الحذف البعيد بعد نجاح الرفع لا قبله، وبنفس مدة الاحتفاظ المحلية
      rclone delete "$REMOTE/db/" --min-age "${KEEP}d" 2>/dev/null || true
    else
      # الفشل يُعلن: نسخة خارجية يُظنّ أنها تُرفع وهي لا تُرفع أسوأ من غيابها
      echo "  ⚠ تعذّر الرفع الخارجي — النسخة المحلية سليمة"
    fi
    rm -f "$ENC"
  else
    echo "  ⚠ تعذّرت التعمية — لم تُرفع نسخة خارجية (لا نرفع نصاً واضحاً)"
  fi
fi

# ─── استرجاع نسخة خارجية ─────────────────────────────────────────────────────
#   rclone copy r2:almoaser-backups/db/<الملف>.gpg /tmp/
#   gpg --batch --passphrase-file /home/eipsys/.config/backup-passphrase \
#       -o /tmp/db.sql.gz -d /tmp/<الملف>.gpg
#   zcat /tmp/db.sql.gz | mysql --defaults-extra-file=<cnf> <db>
#
# **المفتاح نفسه ليس في النسخة الاحتياطية** — ولا يجوز أن يكون. احتفظ بنسخة منه
# خارج هذا الخادم وإلا صارت كل النسخ غير قابلة للفتح حين تحتاجها.
# ─────────────────────────────────────────────────────────────────────────────
