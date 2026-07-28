import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Sidebar } from "./Dashboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { UserPlus, Shield, Mail, Trash2, Users as UsersIcon } from "lucide-react";

type PermissionKey = "viewInvoices" | "createInvoices" | "managePayments" | "manageErpSettings" | "manageJournalEntries";

const PERMISSION_LABELS: Record<PermissionKey, string> = {
  viewInvoices: "عرض الفواتير والتقارير",
  createInvoices: "إنشاء فواتير وعملاء وأصناف",
  managePayments: "تسجيل المدفوعات",
  manageErpSettings: "إدارة اتصال وإعدادات ERP",
  manageJournalEntries: "القيود اليومية",
};

const DEFAULT_PERMS: Record<PermissionKey, boolean> = {
  viewInvoices: true,
  createInvoices: true,
  managePayments: false,
  manageErpSettings: false,
  manageJournalEntries: false,
};

function PermissionsEditor({ value, onChange }: { value: Record<PermissionKey, boolean>; onChange: (v: Record<PermissionKey, boolean>) => void }) {
  return (
    <div className="space-y-3">
      {(Object.keys(PERMISSION_LABELS) as PermissionKey[]).map(key => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm text-navy">{PERMISSION_LABELS[key]}</span>
          <Switch checked={value[key]} onCheckedChange={c => onChange({ ...value, [key]: c })} />
        </div>
      ))}
    </div>
  );
}

function InviteMemberDialog() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<Record<PermissionKey, boolean>>(DEFAULT_PERMS);

  const inviteMutation = trpc.organization.inviteMember.useMutation({
    onSuccess: () => {
      toast.success("تم إضافة المستخدم بنجاح");
      utils.organization.members.invalidate();
      setOpen(false);
      setName(""); setEmail(""); setPassword(""); setPerms(DEFAULT_PERMS);
    },
    onError: e => toast.error(e.message),
  });

  const submit = () => {
    if (!name.trim() || !email.trim() || password.length < 6) {
      toast.error("أكمل الاسم والبريد وكلمة مرور 6 أحرف على الأقل");
      return;
    }
    inviteMutation.mutate({ name: name.trim(), email: email.trim(), password, permissions: perms });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-navy-gradient text-white gap-2">
          <UserPlus className="w-4 h-4" /> إضافة مستخدم
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة مستخدم فرعي</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="member-name">الاسم</Label>
            <Input id="member-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-email">البريد الإلكتروني</Label>
            <Input id="member-email" type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="member-password">كلمة المرور</Label>
            <Input id="member-password" type="password" dir="ltr" value={password} onChange={e => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground">سيسجّل هذا المستخدم دخوله بهذا البريد وكلمة المرور مباشرة (لا علاقة بحساب ERPNext)</p>
          </div>
          <div className="pt-2 border-t border-gray-100">
            <Label className="mb-2 block">الصلاحيات</Label>
            <PermissionsEditor value={perms} onChange={setPerms} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={inviteMutation.isPending} className="w-full bg-navy-gradient text-white">
            {inviteMutation.isPending ? "جارٍ الإضافة..." : "إضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({ member }: { member: {
  id: number; name: string | null; email: string | null; orgRole: "owner" | "member";
  permissions: Record<PermissionKey, boolean>; isActive: boolean;
} }) {
  const utils = trpc.useUtils();
  const [editOpen, setEditOpen] = useState(false);
  const [perms, setPerms] = useState<Record<PermissionKey, boolean>>(member.permissions);

  const updateMutation = trpc.organization.updateMemberPermissions.useMutation({
    onSuccess: () => { toast.success("تم تحديث الصلاحيات"); utils.organization.members.invalidate(); setEditOpen(false); },
    onError: e => toast.error(e.message),
  });
  const removeMutation = trpc.organization.removeMember.useMutation({
    onSuccess: () => { toast.success("تم إلغاء تفعيل المستخدم"); utils.organization.members.invalidate(); },
    onError: e => toast.error(e.message),
  });

  const activePerms = (Object.keys(PERMISSION_LABELS) as PermissionKey[]).filter(k => member.permissions[k]);

  return (
    <div className="flex items-center justify-between gap-4 p-4 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-9 h-9 rounded-full bg-navy/10 text-navy flex items-center justify-center text-sm font-bold flex-shrink-0">
          {(member.name ?? "؟").charAt(0)}
        </span>
        <div className="min-w-0">
          <div className="font-medium text-navy text-sm flex items-center gap-2">
            {member.name ?? "بدون اسم"}
            {member.orgRole === "owner" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-dark font-bold">مالك الحساب</span>}
            {!member.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full badge-cancelled font-bold">معطّل</span>}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <Mail className="w-3 h-3 flex-shrink-0" />{member.email}
          </div>
          {member.orgRole === "member" && (
            <div className="text-[11px] text-muted-foreground mt-1">
              {activePerms.length > 0 ? activePerms.map(k => PERMISSION_LABELS[k]).join(" • ") : "بدون صلاحيات"}
            </div>
          )}
        </div>
      </div>
      {member.orgRole === "member" && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs h-8 gap-1">
                <Shield className="w-3.5 h-3.5" /> الصلاحيات
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" dir="rtl">
              <DialogHeader><DialogTitle>صلاحيات {member.name}</DialogTitle></DialogHeader>
              <PermissionsEditor value={perms} onChange={setPerms} />
              <DialogFooter>
                <Button
                  onClick={() => updateMutation.mutate({ memberId: member.id, permissions: perms })}
                  disabled={updateMutation.isPending}
                  className="w-full bg-navy-gradient text-white"
                >
                  {updateMutation.isPending ? "جارٍ الحفظ..." : "حفظ"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {member.isActive && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs h-8 text-red-600 border-red-200 hover:bg-red-50 gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> إزالة
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl">
                <AlertDialogHeader>
                  <AlertDialogTitle>إزالة {member.name} من الفريق؟</AlertDialogTitle>
                  <AlertDialogDescription>لن يتمكن هذا المستخدم من تسجيل الدخول بعد ذلك. يمكنك إعادة دعوته لاحقاً ببريد جديد.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                  <AlertDialogAction onClick={() => removeMutation.mutate({ memberId: member.id })} className="bg-red-600 hover:bg-red-700">
                    إزالة
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </div>
  );
}

export default function Team() {
  const { user, isAuthenticated, loading } = useAuth();
  const { data: org } = trpc.organization.get.useQuery(undefined, { enabled: isAuthenticated });
  const { data: members } = trpc.organization.members.useQuery(undefined, { enabled: isAuthenticated && user?.orgRole === "owner" });

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <div className="min-h-screen flex items-center justify-center"><Button onClick={() => { window.location.href = "/login"; }} className="bg-navy-gradient text-white">تسجيل الدخول</Button></div>;

  if (user?.orgRole !== "owner") {
    return (
      <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
        <Sidebar active="/team" />
        <main className="flex-1 p-4 md:p-8 flex items-center justify-center">
          <div className="text-center">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-navy">لمالك الحساب فقط</h2>
            <p className="text-muted-foreground">إدارة الفريق متاحة لمالك الحساب فقط</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      <Sidebar active="/team" />
      <main className="flex-1 p-4 md:p-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-navy flex items-center gap-2">
              <UsersIcon className="w-6 h-6" /> إدارة الفريق
            </h1>
            <p className="text-muted-foreground mt-1">
              {org?.name ? `أعضاء ${org.name}` : "أعضاء حسابك"} — كل الأعضاء يشتركون في نفس اتصال ERPNext ورصيد النقاط
            </p>
          </div>
          <InviteMemberDialog />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          {members?.map(m => <MemberRow key={m.id} member={m} />)}
          {(members?.length ?? 0) === 0 && (
            <div className="p-10 text-center text-muted-foreground text-sm">لا يوجد أعضاء بعد</div>
          )}
        </div>
      </main>
    </div>
  );
}
