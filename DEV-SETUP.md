# بيئة التطوير — ما تبقّى لتشغيلها

النسخة جاهزة في `/home/eipsys/work/almoaser-dev` على المنفذ **3001**، منفصلة عن
الإنتاج في المجلد والعملية والمنفذ. بقي شيئان يحتاجان صلاحية لا أملكها.

---

## ١) قاعدة بيانات منفصلة — **إلزامي**

هذا ليس تفصيلاً تنظيمياً. تطويرٌ يكتب في قاعدة الإنتاج ليس بيئة تطوير، بل
مخاطرةٌ بمظهر أمان: أول اختبار حذف يمسح بيانات عميل حقيقي. لذلك يرفض
`dev-up.sh` التشغيل إن وجد البيئتين تشيران إلى القاعدة نفسها.

من لوحة Hestia ← **DB** ← Add Database:

| الحقل | القيمة |
|---|---|
| Database | `dev` (سيصير `almoaser-ai_dev`) |
| User | `dev` |
| Password | ولّد كلمة قوية واحتفظ بها |

ثم ضع الرابط في `/home/eipsys/work/almoaser-dev/.env`:

```
DATABASE_URL=mysql://almoaser-ai_dev:كلمة_المرور@localhost:3306/almoaser-ai_dev
```

وانسخ بنية الجداول من الإنتاج **بلا بيانات العملاء**:

```bash
cd /home/eipsys/work/almoaser-dev
bash scripts/seed-dev-db.sh
```

السكربت ينسخ الجداول والبنية، ثم البيانات المرجعية وحدها (الباقات والأسعار)،
ولا ينقل مستخدماً ولا اشتراكاً ولا محادثة ولا دفعة.

---

## ٢) الوصول من المتصفح على `erpsys.cloud/dev`

مجلد على نفس النطاق لا نطاق فرعي — لا شهادة جديدة ولا سجل DNS.

**أمر واحد بصلاحية root:**

```bash
sudo cp /home/eipsys/work/almoaser-dev/deploy/nginx.ssl.conf_dev \
        /home/almoaser-ai/conf/web/erpsys.cloud/nginx.ssl.conf_dev && \
sudo nginx -t && sudo systemctl reload nginx
```

قالب Hestia يحتوي `include .../nginx.ssl.conf_*;` فيلتقط الملف تلقائياً.
و`nginx -t` قبل إعادة التحميل مقصود: إعدادٌ خاطئ يُعاد تحميله يُسقط
**erpsys.cloud نفسه** لا بيئة التطوير وحدها.

**ملاحظة على التحديث:** إعادة توليد إعدادات النطاق من Hestia (تغيير قالب،
تجديد شهادة أحياناً) لا تحذف هذا الملف لأنه خارج القالب — لكن راجعه إن اختفى
المسار فجأة.

**الحماية:** المقطع يمنع الفهرسة (`X-Robots-Tag`). إن أردت منع الدخول أصلاً
أضف داخل `location /dev/`:

```nginx
auth_basic "dev";
auth_basic_user_file /home/almoaser-ai/conf/web/erpsys.cloud/.htpasswd-dev;
```

وأنشئ الملف بـ `htpasswd -c`. نسخة التطوير تحمل كوداً غير مُراجَع، ولا يصح أن
يفتحها عميل ظنّاً أنها المنصة.

---

## الاستعمال اليومي

```bash
cd /home/eipsys/work/almoaser-dev

git switch -c feature/اسم-التعديل     # فرع لكل تعديل
# ... عدّل ...
bash scripts/dev-up.sh                # بناء وتشغيل على 3001 وerpsys.cloud/dev
# ... راجع النتيجة بنفسك ...
git add -A && git commit -m "..."
bash scripts/promote.sh               # اختبارات ← دمج في main ← نشر للإنتاج
```

`promote.sh` يرفض الترقية من `main` ومع وجود تعديلات غير محفوظة، ويشغّل بوابة
الأنواع والاختبارات قبل أن يمسّ الإنتاج. والنشر يتم من مجلد الإنتاج بنفس
`npm run deploy` — لا نسخ ملفات بين المجلدين، كي لا يحمل الإنتاج شيئاً ليس في
التاريخ ولا يمكن التراجع عنه.
