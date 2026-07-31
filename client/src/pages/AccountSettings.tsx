import { useState, useEffect } from "react";
import PhoneVerification from "@/components/PhoneVerification";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { User, Building2, Save, Server, CheckCircle2, ArrowLeft, Mail } from "lucide-react";

export default function AccountSettings() {
  const { user, isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();
  const { data: subscription } = trpc.subscription.get.useQuery(undefined, { enabled: isAuthenticated });
  const { data: erpConn } = trpc.erpConnection.get.useQuery(undefined, { enabled: isAuthenticated });

  const [profile, setProfile] = useState({ name: "", email: "" });
  const [company, setCompany] = useState({ companyName: "", companyType: "", phone: "", vatNumber: "" });

  useEffect(() => {
    if (user) setProfile({ name: user.name ?? "", email: user.email ?? "" });
  }, [user]);

  useEffect(() => {
    if (subscription) {
      setCompany({
        companyName: subscription.companyName ?? "",
        companyType: subscription.companyType ?? "",
        phone: subscription.phone ?? "",
        vatNumber: subscription.vatNumber ?? "",
      });
    }
  }, [subscription]);

  const profileMutation = trpc.profile.update.useMutation({
    onSuccess: () => { toast.success("تم تحديث الملف الشخصي"); utils.auth.me.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const companyMutation = trpc.profile.updateCompany.useMutation({
    onSuccess: () => { toast.success("تم تحديث بيانات الشركة"); utils.subscription.get.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/settings" />
      <main className="flex-1 p-4 md:p-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy">إعدادات الحساب</h1>
          <p className="text-muted-foreground mt-1">إدارة بياناتك الشخصية وبيانات شركتك</p>
        </div>

        {/* Personal profile */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center">
              <User className="w-5 h-5 text-navy" />
            </div>
            <div>
              <h2 className="font-semibold text-navy">الملف الشخصي</h2>
              <p className="text-xs text-muted-foreground">اسمك وبريدك الإلكتروني</p>
            </div>
          </div>
          <form onSubmit={e => { e.preventDefault(); profileMutation.mutate({ name: profile.name || undefined, email: profile.email || undefined }); }} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="acc-name" className="text-navy font-medium">الاسم</Label>
                <Input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} id="acc-name" placeholder="اسمك الكامل" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="acc-email" className="text-navy font-medium">البريد الإلكتروني</Label>
                <Input type="email" value={profile.email} onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} id="acc-email" placeholder="you@example.com" className="mt-1" dir="ltr" />
              </div>
            </div>
            <Button type="submit" disabled={profileMutation.isPending} className="bg-navy-gradient text-white">
              <Save className="w-4 h-4 ml-2" />
              {profileMutation.isPending ? "جاري الحفظ..." : "حفظ الملف الشخصي"}
            </Button>
          </form>
        </div>

        {/* Company info */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-navy" />
            </div>
            <div>
              <h2 className="font-semibold text-navy">بيانات الشركة</h2>
              <p className="text-xs text-muted-foreground">مرتبطة باشتراكك الحالي</p>
            </div>
          </div>
          {!subscription ? (
            <p className="text-sm text-muted-foreground py-4">لا يوجد اشتراك بعد — اشترك في باقة أولاً لإدارة بيانات شركتك.</p>
          ) : (
            <form onSubmit={e => { e.preventDefault(); companyMutation.mutate(company); }} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="co-name" className="text-navy font-medium">اسم الشركة</Label>
                  <Input value={company.companyName} onChange={e => setCompany(c => ({ ...c, companyName: e.target.value }))} id="co-name" placeholder="اسم شركتك" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="co-type" className="text-navy font-medium">نوع النشاط</Label>
                  <Input value={company.companyType} onChange={e => setCompany(c => ({ ...c, companyType: e.target.value }))} id="co-type" placeholder="مثال: تجارة تجزئة" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="co-phone" className="text-navy font-medium">رقم الجوال</Label>
                  <Input value={company.phone} onChange={e => setCompany(c => ({ ...c, phone: e.target.value }))} id="co-phone" placeholder="05xxxxxxxx" className="mt-1" dir="ltr" />
                </div>
                <div>
                  <Label htmlFor="co-vat" className="text-navy font-medium">الرقم الضريبي</Label>
                  <Input value={company.vatNumber} onChange={e => setCompany(c => ({ ...c, vatNumber: e.target.value }))} id="co-vat" placeholder="3xxxxxxxxxxxxxx" className="mt-1" dir="ltr" />
                </div>
              </div>
              <Button type="submit" disabled={companyMutation.isPending} className="bg-navy-gradient text-white">
                <Save className="w-4 h-4 ml-2" />
                {companyMutation.isPending ? "جاري الحفظ..." : "حفظ بيانات الشركة"}
              </Button>
            </form>
          )}
        </div>

        {/* تأكيد البريد الإلكتروني وإشعاراته */}
        <EmailSettingsCard isAuthenticated={isAuthenticated} />

        {/* ERPNext connection — moved to /channels */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mt-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center">
              <Server className="w-5 h-5 text-navy" />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-navy">اتصال نظام ERP الخاص بك (ERPNext أو Odoo)</h2>
              <p className="text-xs text-muted-foreground">انتقلت إدارة اتصال نظام ERP إلى صفحة القنوات والربط لتكون مع إعدادات واتساب وتيليجرام</p>
            </div>
            {erpConn && (
              <span className="flex items-center gap-1 text-xs text-green-800 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                متصل
              </span>
            )}
            <Link href="/channels">
              <Button variant="outline" className="border-navy/20 text-navy">
                إدارة الاتصال
                <ArrowLeft className="w-4 h-4 mr-2" />
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function EmailSettingsCard({ isAuthenticated }: { isAuthenticated: boolean }) {
  const utils = trpc.useUtils();
  const { data } = trpc.email.status.useQuery(undefined, { enabled: isAuthenticated });
  const sendMutation = trpc.email.sendVerification.useMutation({
    onSuccess: () => toast.success("أرسلنا رابط التأكيد إلى بريدك — راجع صندوق الوارد (وربما مجلد الرسائل غير المرغوبة)"),
    onError: e => toast.error(e.message),
  });
  const prefMutation = trpc.email.setNotifications.useMutation({
    onSuccess: () => { toast.success("تم تحديث تفضيل إشعارات البريد"); utils.email.status.invalidate(); },
    onError: e => toast.error(e.message),
  });

  if (!data) return null;

  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm mt-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-navy/5 flex items-center justify-center shrink-0">
          <Mail className="w-5 h-5 text-navy" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-navy">البريد الإلكتروني</h2>
            {data.verified ? (
              <span className="flex items-center gap-1 text-xs text-green-800 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> مؤكَّد
              </span>
            ) : (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
                غير مؤكَّد
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1" dir="ltr">{data.email ?? "—"}</p>

          {!data.emailServiceConfigured && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">
              خدمة البريد غير مضبوطة على السيرفر بعد — لن تُرسل أي رسائل حتى يُضاف مفتاح المزوّد.
            </p>
          )}

          {!data.verified && data.emailServiceConfigured && (
            <Button
              size="sm" className="mt-3 gap-1.5"
              disabled={sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
            >
              {sendMutation.isPending ? "جارٍ الإرسال..." : "أرسل رابط التأكيد"}
            </Button>
          )}

          <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={data.notificationsEnabled}
              disabled={prefMutation.isPending}
              onChange={e => prefMutation.mutate({ enabled: e.target.checked })}
              className="w-4 h-4 accent-navy relative [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:content-[''] [@media(pointer:coarse)]:after:-inset-4"
            />
            <span className="text-foreground">استلام الإشعارات والتذكيرات على البريد الإلكتروني</span>
          </label>
          <p className="text-[11px] text-muted-foreground mt-1">
            إيصالات الدفع والتجديد تُرسل دائماً لأنها مستندات مالية.
          </p>

          {/* تأكيد الجوال — خطوة مستقلة عن البريد ولها مسار تحقق خاص */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <h2 className="font-semibold text-navy mb-3">رقم الجوال</h2>
            <PhoneVerification />
          </div>
        </div>
      </div>
    </div>
  );
}
