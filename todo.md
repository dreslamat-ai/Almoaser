# المعاصر SaaS — قائمة المهام

## قاعدة البيانات والـ Schema
- [x] إضافة جدول subscriptions (الاشتراكات)
- [x] إضافة جدول plans (الباقات)
- [x] إضافة جدول tasks (المهام المحاسبية)
- [x] إضافة جدول service_invoices (فواتير الخدمة)
- [x] إضافة جدول registration_requests (طلبات التسجيل)
- [x] تشغيل pnpm db:push وتطبيق Schema على قاعدة البيانات
- [x] إدراج الباقات الثلاث (أساسية 299، احترافية 699، مؤسسية 1499)

## Landing Page (الصفحة الرئيسية)
- [x] تحديث الهوية البصرية بألوان المعاصر (Navy Blue + Gold)
- [x] بناء Hero Section بهوية المعاصر
- [x] قسم الخدمات الست
- [x] قسم الباقات الثلاث مع الأسعار والمزايا
- [x] قسم كيف نعمل (6 خطوات)
- [x] نموذج طلب الاستشارة المجانية
- [x] Footer بهوية المعاصر مع معلومات التواصل

## نظام المصادقة والتسجيل
- [x] تسجيل الدخول عبر Manus OAuth
- [x] حماية صفحات لوحة التحكم
- [x] ربط OAuth بنظام الاشتراكات

## لوحة تحكم العميل (Dashboard)
- [x] صفحة Overview (ملخص الحساب والاشتراك)
- [x] صفحة المهام (Tasks) — عرض وإنشاء وتحديث المهام المحاسبية
- [x] صفحة الفواتير (Invoices) — فواتير الخدمة الشهرية
- [x] صفحة الاشتراك (Subscription) — اختيار الباقة والترقية

## لوحة تحكم الإدارة (Admin)
- [x] عرض طلبات التسجيل مع بيانات التواصل
- [x] إدارة الاشتراكات مع أسماء الباقات
- [x] إدارة المهام الكلية مع تسميات عربية
- [x] إحصائيات عامة (4 بطاقات)

## الخلفية (Backend)
- [x] إجراءات tRPC للباقات (plans.list)
- [x] إجراءات tRPC للاشتراكات (subscription.create, get, upgrade)
- [x] إجراءات tRPC للمهام (tasks.create, list, updateStatus)
- [x] إجراءات tRPC للفواتير (invoices.list)
- [x] إجراءات tRPC للتسجيل (register.submit)
- [x] إجراءات tRPC للإدارة (admin.registrations, subscriptions, tasks)

## الاختبارات
- [x] اختبار auth.logout يمر بنجاح
- [x] اختبارات ERPNext connection (5/5 tests passed)

## ربط ERPNext (مكتمل)
- [x] حفظ بيانات الاتصال كـ Secrets (ERPNEXT_URL, ERPNEXT_USERNAME, ERPNEXT_PASSWORD)
- [x] بناء Backend proxy مع session caching (erpnext router في server/routers.ts)
- [x] إجراءات tRPC: testConnection, getCompanyInfo, getAccounts, getItems, getJournalEntries
- [x] صفحة ERPNextDashboard.tsx تعرض بيانات حقيقية من demo.almoaser.cloud
- [x] إضافة Route /erp في App.tsx
- [x] إضافة رابط "نظام ERP" في Sidebar لوحة التحكم

## Backlog (مرحلة لاحقة)

## داشبورد ERPNext الاحترافي + وكيل الذكاء الاصطناعي + PWA (مكتمل)
- [x] داشبورد احترافي مع KPIs (إيرادات، فواتير، عملاء، موردين/أصناف)
- [x] رسوم بيانية: Area Chart للإيرادات الشهرية، Pie Chart لحالة الفواتير، Bar Chart للمقارنة
- [x] جدول آخر الفواتير وجدول العملاء في الداشبورد
- [x] صفحة وكيل الذكاء الاصطناعي /agent مع اقتراحات جاهزة وتاريخ محادثة
- [x] صفحة إعدادات القنوات /channels مع ربط واتساب وتيليجرام واختبار مباشر
- [x] channels router في backend (saveSettings, testWhatsapp, testTelegram)
- [x] دعم PWA كامل: manifest.json + أيقونات + install banner في DashboardLayout
- [x] الداشبورد هو الصفحة الرئيسية (/)
- [x] تحديث DashboardLayout بعنوان "AI × ERPNext" وقائمة تنقل كاملة

- [ ] ربط نظام دفع (Stripe/Moyasar) — يتطلب تكاملاً خارجياً
- [ ] إشعارات بريد إلكتروني للمسؤول عند تسجيل عميل جديد
- [ ] صفحة إعدادات حساب العميل
- [ ] تصدير الفواتير كـ PDF
- [ ] تعليقات المحاسب على المهام
- [ ] إضافة أدوار Customer/Sales Invoice للمستخدم ai في ERPNext
- [ ] عرض فواتير المبيعات والعملاء عند توفر الصلاحيات
