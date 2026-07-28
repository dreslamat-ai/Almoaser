import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  MessageSquare, Send, Settings, CheckCircle2, XCircle,
  Eye, EyeOff, Zap, Globe, Shield, Info, Server, Plug, Trash2, Save,
} from "lucide-react";

function FieldGroup({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

function ErpConnectionCard() {
  const utils = trpc.useUtils();
  const { data: erpConn } = trpc.erpConnection.get.useQuery();
  const [erp, setErp] = useState({ provider: "erpnext" as "erpnext" | "odoo", url: "", username: "", password: "", database: "" });
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    if (erpConn) setErp(prev => ({ ...prev, provider: erpConn.provider, url: erpConn.url, username: erpConn.username, database: erpConn.database ?? "" }));
  }, [erpConn]);

  const erpSaveMutation = trpc.erpConnection.save.useMutation({
    onSuccess: (r) => {
      toast.success(`تم الاتصال والحفظ بنجاح — مسجّل باسم: ${r.loggedInAs ?? erp.username}`);
      setErp(prev => ({ ...prev, password: "" }));
      utils.erpConnection.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const erpTestMutation = trpc.erpConnection.test.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(`الاتصال ناجح — مسجّل باسم: ${r.loggedInAs}`);
      else toast.error(r.error ?? "فشل الاختبار");
    },
    onError: (e) => toast.error(e.message),
  });
  const erpRemoveMutation = trpc.erpConnection.remove.useMutation({
    onSuccess: () => {
      toast.success("تم حذف الاتصال — سيُستخدم اتصال النظام الافتراضي");
      setErp({ provider: "erpnext", url: "", username: "", password: "", database: "" });
      utils.erpConnection.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Server className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">اتصال نظام ERP الخاص بك</CardTitle>
              <CardDescription className="text-xs">اربط الوكيل الذكي ولوحات البيانات بنظام ERPNext أو Odoo الخاص بشركتك</CardDescription>
            </div>
          </div>
          <Badge variant={erpConn ? "default" : "secondary"} className="text-xs">
            {erpConn ? <><CheckCircle2 className="w-3 h-3 ml-1" />متصل</> : <><XCircle className="w-3 h-3 ml-1" />غير متصل</>}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <form onSubmit={e => { e.preventDefault(); erpSaveMutation.mutate(erp); }} className="space-y-4">
          <FieldGroup label="نوع النظام">
            <Select value={erp.provider} onValueChange={v => setErp(p => ({ ...p, provider: v as "erpnext" | "odoo" }))}>
              <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="erpnext">ERPNext</SelectItem>
                <SelectItem value="odoo">Odoo</SelectItem>
              </SelectContent>
            </Select>
          </FieldGroup>
          <FieldGroup label="رابط النظام" description={`عنوان نظام ${erp.provider === "odoo" ? "Odoo" : "ERPNext"} الخاص بشركتك`}>
            <Input value={erp.url} onChange={e => setErp(p => ({ ...p, url: e.target.value }))} placeholder={erp.provider === "odoo" ? "https://your-company.odoo.com" : "https://your-company.erpnext.com"} dir="ltr" className="font-mono text-xs" />
          </FieldGroup>
          {erp.provider === "odoo" && (
            <FieldGroup label="اسم قاعدة البيانات" description="اسم قاعدة بيانات Odoo (يظهر في رابط تسجيل الدخول أو من مدير قواعد البيانات)">
              <Input value={erp.database} onChange={e => setErp(p => ({ ...p, database: e.target.value }))} placeholder="my_company_db" dir="ltr" className="font-mono text-xs" />
            </FieldGroup>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="اسم المستخدم">
              <Input value={erp.username} onChange={e => setErp(p => ({ ...p, username: e.target.value }))} placeholder="user@example.com" dir="ltr" className="font-mono text-xs" />
            </FieldGroup>
            <FieldGroup label="كلمة المرور" description="تُحفظ مشفرة (AES-256) ولا تُعرض مجدداً">
              <div className="relative">
                <Input type={showPwd ? "text" : "password"} value={erp.password} onChange={e => setErp(p => ({ ...p, password: e.target.value }))} placeholder={erpConn ? "••••••• (اتركها فارغة للإبقاء)" : "كلمة المرور"} dir="ltr" className="pl-10 font-mono text-xs" />
                <button type="button" onClick={() => setShowPwd(s => !s)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </FieldGroup>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={erpSaveMutation.isPending || !erp.url || !erp.username || !erp.password || (erp.provider === "odoo" && !erp.database)} className="gap-1.5">
              <Save className="w-3.5 h-3.5" />
              {erpSaveMutation.isPending ? "جاري الاختبار والحفظ..." : "اختبار وحفظ الاتصال"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={erpTestMutation.isPending || !erp.url || !erp.username || !erp.password || (erp.provider === "odoo" && !erp.database)}
              onClick={() => erpTestMutation.mutate(erp)} className="gap-1.5">
              <Plug className="w-3.5 h-3.5" />
              {erpTestMutation.isPending ? "جاري الاختبار..." : "اختبار فقط"}
            </Button>
            {erpConn && (
              <Button type="button" variant="outline" size="sm" disabled={erpRemoveMutation.isPending}
                onClick={() => { if (confirm("هل تريد حذف اتصال ERP الخاص بك؟ سيعود النظام للاتصال الافتراضي.")) erpRemoveMutation.mutate(); }}
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
                حذف الاتصال
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ChannelSettings() {
  const [showTokens, setShowTokens] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);

  // WhatsApp
  const [waToken, setWaToken] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [waVerifyToken, setWaVerifyToken] = useState("");
  const [waTestNumber, setWaTestNumber] = useState("");

  // Telegram
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");

  const saveMutation = trpc.channels.saveSettings.useMutation({
    onSuccess: () => toast.success("تم حفظ إعدادات القنوات بنجاح"),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const testWaMutation = trpc.channels.testWhatsapp.useMutation({
    onSuccess: (r: { success: boolean; error?: string }) => r.success
      ? toast.success("تم إرسال رسالة واتساب تجريبية بنجاح")
      : toast.error(r.error ?? "فشل الاختبار"),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const testTgMutation = trpc.channels.testTelegram.useMutation({
    onSuccess: (r: { success: boolean; error?: string }) => r.success
      ? toast.success("تم إرسال رسالة تيليجرام تجريبية بنجاح")
      : toast.error(r.error ?? "فشل الاختبار"),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const handleSave = () => {
    saveMutation.mutate({
      whatsappToken: waToken || undefined,
      whatsappPhoneId: waPhoneId || undefined,
      whatsappVerifyToken: waVerifyToken || undefined,
      telegramBotToken: tgToken || undefined,
      telegramChatId: tgChatId || undefined,
      agentEnabled,
    });
  };

  const webhookBase = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">إعدادات القنوات</h1>
            <p className="text-xs text-muted-foreground mt-0.5">ربط نظام ERPNext وواتساب وتيليجرام بوكيل الذكاء الاصطناعي</p>
          </div>
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
            {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
          </Button>
        </div>

        {/* ERPNext Connection */}
        <ErpConnectionCard />

        {/* Agent Toggle */}
        <Card className="shadow-sm border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">تفعيل الوكيل الذكي</p>
                  <p className="text-xs text-muted-foreground">الرد التلقائي على الرسائل الواردة</p>
                </div>
              </div>
              <Switch checked={agentEnabled} onCheckedChange={setAgentEnabled} />
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-[#25D366]" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">واتساب Business</CardTitle>
                  <CardDescription className="text-xs">WhatsApp Cloud API</CardDescription>
                </div>
              </div>
              <Badge variant={waToken ? "default" : "secondary"} className="text-xs">
                {waToken ? <><CheckCircle2 className="w-3 h-3 ml-1" />مُعدّ</> : <><XCircle className="w-3 h-3 ml-1" />غير مُعدّ</>}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            <div className="grid gap-4">
              <FieldGroup label="Access Token" description="رمز الوصول من Meta Developer Console">
                <div className="relative">
                  <Input
                    type={showTokens ? "text" : "password"}
                    placeholder="EAAxxxxxxxxxx..."
                    value={waToken}
                    onChange={e => setWaToken(e.target.value)}
                    className="pl-10 font-mono text-xs"
                    dir="ltr"
                  />
                  <button className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowTokens(v => !v)}>
                    {showTokens ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Phone Number ID" description="معرّف رقم الهاتف">
                  <Input placeholder="1234567890" value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} className="font-mono text-xs" dir="ltr" />
                </FieldGroup>
                <FieldGroup label="Verify Token" description="رمز التحقق للـ Webhook">
                  <Input placeholder="my_verify_token" value={waVerifyToken} onChange={e => setWaVerifyToken(e.target.value)} className="font-mono text-xs" dir="ltr" />
                </FieldGroup>
              </div>
            </div>

            <Separator />

            {/* Webhook URL */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Globe className="w-3.5 h-3.5" /> Webhook URL
              </div>
              <code className="text-xs text-muted-foreground break-all block" dir="ltr">
                {webhookBase}/api/webhooks/whatsapp
              </code>
              <p className="text-xs text-muted-foreground">أضف هذا الرابط في إعدادات Meta Developer Console</p>
            </div>

            {/* Test */}
            <div className="flex items-center gap-2">
              <Input placeholder="رقم الاختبار (مثال: 96891234567)" value={waTestNumber} onChange={e => setWaTestNumber(e.target.value)} className="flex-1 text-sm" dir="ltr" />
              <Button
                variant="outline" size="sm"
                disabled={!waToken || !waPhoneId || !waTestNumber || testWaMutation.isPending}
                onClick={() => testWaMutation.mutate({ token: waToken, phoneId: waPhoneId, testNumber: waTestNumber })}
                className="gap-1.5 shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {testWaMutation.isPending ? "جارٍ..." : "اختبار"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Telegram */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#0088cc]/10 flex items-center justify-center">
                  <Send className="w-4 h-4 text-[#0088cc]" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">تيليجرام Bot</CardTitle>
                  <CardDescription className="text-xs">Telegram Bot API</CardDescription>
                </div>
              </div>
              <Badge variant={tgToken ? "default" : "secondary"} className="text-xs">
                {tgToken ? <><CheckCircle2 className="w-3 h-3 ml-1" />مُعدّ</> : <><XCircle className="w-3 h-3 ml-1" />غير مُعدّ</>}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Bot Token" description="رمز البوت من @BotFather">
                <div className="relative">
                  <Input
                    type={showTokens ? "text" : "password"}
                    placeholder="123456:ABCdef..."
                    value={tgToken}
                    onChange={e => setTgToken(e.target.value)}
                    className="font-mono text-xs"
                    dir="ltr"
                  />
                </div>
              </FieldGroup>
              <FieldGroup label="Chat ID" description="معرّف المجموعة أو القناة">
                <Input placeholder="-1001234567890" value={tgChatId} onChange={e => setTgChatId(e.target.value)} className="font-mono text-xs" dir="ltr" />
              </FieldGroup>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex gap-2">
              <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-xs text-blue-700 space-y-1">
                <p className="font-medium">كيفية إنشاء بوت تيليجرام:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-blue-600">
                  <li>افتح تيليجرام وابحث عن @BotFather</li>
                  <li>أرسل /newbot واتبع التعليمات</li>
                  <li>انسخ الـ Token وضعه هنا</li>
                  <li>أضف البوت للمجموعة واحصل على Chat ID</li>
                </ol>
              </div>
            </div>

            <Button
              variant="outline" size="sm"
              disabled={!tgToken || !tgChatId || testTgMutation.isPending}
              onClick={() => testTgMutation.mutate({ token: tgToken, chatId: tgChatId })}
              className="gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {testTgMutation.isPending ? "جارٍ الإرسال..." : "إرسال رسالة تجريبية"}
            </Button>
          </CardContent>
        </Card>

        {/* Security Note */}
        <Card className="shadow-sm border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex gap-3">
            <Shield className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">ملاحظة أمنية</p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                يتم تشفير جميع الرموز وتخزينها بشكل آمن. لا تشارك رموز الوصول مع أي طرف آخر.
                تأكد من تحديد صلاحيات محدودة للمستخدم في Almoaser AI ERP.
              </p>
            </div>
          </CardContent>
        </Card>

      </div>
    </DashboardLayout>
  );
}
