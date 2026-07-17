import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import {
  CheckCircle2, XCircle, RefreshCw, Building2, DollarSign, Globe,
  BookOpen, FileText, BarChart3, Settings, LogOut, Database,
  Package, Layers, TrendingUp, AlertCircle, ChevronRight, Activity
} from "lucide-react";
import { useState } from "react";
import { startLogin } from "@/const";
import { Button } from "@/components/ui/button";

// ─── Sidebar (reused from Dashboard) ─────────────────────────────────────────
function Sidebar({ active }: { active: string }) {
  const { logout } = useAuth();
  const [, navigate] = useLocation();
  const navItems = [
    { path: "/dashboard", label: "الرئيسية", icon: <BarChart3 className="w-5 h-5" /> },
    { path: "/tasks", label: "المهام", icon: <CheckCircle2 className="w-5 h-5" /> },
    { path: "/invoices", label: "الفواتير", icon: <FileText className="w-5 h-5" /> },
    { path: "/subscription", label: "الاشتراك", icon: <DollarSign className="w-5 h-5" /> },
    { path: "/erp", label: "نظام ERP", icon: <Database className="w-5 h-5" /> },
  ];
  return (
    <aside className="w-64 bg-navy-hero min-h-screen flex flex-col">
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-gold" />
          </div>
          <div>
            <div className="font-bold text-white">Almoaser <span className="text-gold text-xs font-light">AI ERP</span></div>
            <div className="text-xs text-white/50">لوحة التحكم</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <button key={item.path} onClick={() => navigate(item.path)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all ${active === item.path ? "bg-white/15 text-white font-medium" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-white/10 space-y-1">
        <button onClick={() => navigate("/")} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-white/60 hover:bg-white/10 hover:text-white transition-all">
          <Settings className="w-5 h-5" />
          الإعدادات
        </button>
        <button onClick={() => logout()} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-500/10 transition-all">
          <LogOut className="w-5 h-5" />
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {connected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {connected ? "متصل" : "غير متصل"}
    </span>
  );
}

// ─── Account Row ──────────────────────────────────────────────────────────────
function AccountRow({ account }: { account: Record<string, unknown> }) {
  const isGroup = account.is_group === 1;
  const rootType = account.root_type as string;
  const rootColors: Record<string, string> = {
    Asset: "text-blue-600 bg-blue-50",
    Liability: "text-red-600 bg-red-50",
    Equity: "text-purple-600 bg-purple-50",
    Income: "text-green-600 bg-green-50",
    Expense: "text-orange-600 bg-orange-50",
  };
  const colorClass = rootColors[rootType] ?? "text-gray-600 bg-gray-50";

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          {isGroup ? <Layers className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />}
          <span className={`text-sm ${isGroup ? "font-semibold text-gray-800" : "text-gray-600"}`}>
            {account.account_name as string || account.name as string}
          </span>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
          {rootType || "—"}
        </span>
      </td>
      <td className="py-3 px-4 text-xs text-gray-500">
        {account.account_type as string || "—"}
      </td>
      <td className="py-3 px-4 text-xs text-gray-400 font-mono">
        {account.account_currency as string || "—"}
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ERPNextDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [refreshKey, setRefreshKey] = useState(0);

  // Queries
  const { data: connectionData, isLoading: connLoading, refetch: refetchConn } = trpc.erpnext.testConnection.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
  });

  const { data: accounts, isLoading: accountsLoading } = trpc.erpnext.getAccounts.useQuery(
    { limit: 50 },
    { enabled: connectionData?.connected === true, staleTime: 120_000 }
  );

  const { data: items, isLoading: itemsLoading } = trpc.erpnext.getItems.useQuery(
    { limit: 20 },
    { enabled: connectionData?.connected === true, staleTime: 120_000 }
  );

  const { data: journalData, isLoading: journalLoading } = trpc.erpnext.getJournalEntries.useQuery(
    { limit: 10 },
    { enabled: connectionData?.connected === true, staleTime: 60_000 }
  );

  // Auth guard
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-navy-hero border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-500">جارٍ التحميل...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <h2 className="text-xl font-bold text-navy-hero mb-2">يجب تسجيل الدخول</h2>
          <p className="text-gray-500 mb-4">للوصول إلى لوحة نظام ERP</p>
          <Button onClick={() => startLogin()}>تسجيل الدخول</Button>
        </div>
      </div>
    );
  }

  const company = connectionData?.connected ? connectionData.company : null;
  const journalEntries = journalData?.data ?? [];
  const journalError = journalData?.error;

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    refetchConn();
  };

  return (
    <div className="flex min-h-screen bg-gray-50" dir="rtl">
      <Sidebar active="/erp" />

      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-navy-hero flex items-center gap-3">
                <Database className="w-6 h-6 text-gold" />
                نظام ERP المتصل
              </h1>
              <p className="text-sm text-gray-500 mt-1">بيانات حقيقية من demo.almoaser.cloud</p>
            </div>
            <div className="flex items-center gap-3">
              {connLoading ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  جارٍ الاتصال...
                </span>
              ) : (
                <StatusBadge connected={connectionData?.connected ?? false} />
              )}
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                تحديث
              </button>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8">

          {/* Company Info Card */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-navy-hero" />
              <h2 className="font-semibold text-gray-800">معلومات الشركة</h2>
            </div>
            {connLoading ? (
              <div className="p-6 flex gap-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex-1 h-16 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : company ? (
              <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-navy-hero/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Building2 className="w-4 h-4 text-navy-hero" />
                    <span className="text-xs text-gray-500">اسم الشركة</span>
                  </div>
                  <div className="font-bold text-navy-hero text-lg">{company.name}</div>
                  <div className="text-xs text-gray-400 mt-1">اختصار: {company.abbr}</div>
                </div>
                <div className="bg-gold/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-gold" />
                    <span className="text-xs text-gray-500">العملة الافتراضية</span>
                  </div>
                  <div className="font-bold text-gold text-lg">{company.defaultCurrency}</div>
                  <div className="text-xs text-gray-400 mt-1">ريال عُماني</div>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-gray-500">الدولة</span>
                  </div>
                  <div className="font-bold text-green-700 text-lg">{company.country}</div>
                  <div className="text-xs text-gray-400 mt-1">مسجلة في النظام</div>
                </div>
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-blue-600" />
                    <span className="text-xs text-gray-500">حالة الاتصال</span>
                  </div>
                  <div className="font-bold text-blue-700 text-lg">نشط</div>
                  <div className="text-xs text-gray-400 mt-1">demo.almoaser.cloud</div>
                </div>
              </div>
            ) : (
              <div className="p-6 flex items-center gap-3 text-red-600">
                <XCircle className="w-5 h-5" />
                <span className="text-sm">{connectionData?.error ?? "تعذّر الاتصال بنظام ERPNext"}</span>
              </div>
            )}
          </div>

          {/* Accounts Table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-navy-hero" />
                <h2 className="font-semibold text-gray-800">شجرة الحسابات</h2>
              </div>
              {accounts && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                  {(accounts as unknown[]).length} حساب
                </span>
              )}
            </div>
            {accountsLoading ? (
              <div className="p-6 space-y-2">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : accounts && (accounts as unknown[]).length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500">اسم الحساب</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500">النوع الجذري</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500">نوع الحساب</th>
                      <th className="py-3 px-4 text-xs font-semibold text-gray-500">العملة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(accounts as Record<string, unknown>[]).map((account, i) => (
                      <AccountRow key={i} account={account} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">لا توجد حسابات متاحة</p>
              </div>
            )}
          </div>

          {/* Items & Journal Entries in 2 columns */}
          <div className="grid md:grid-cols-2 gap-6">

            {/* Items */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-navy-hero" />
                  <h2 className="font-semibold text-gray-800">الأصناف والخدمات</h2>
                </div>
                {items && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                    {(items as unknown[]).length} صنف
                  </span>
                )}
              </div>
              {itemsLoading ? (
                <div className="p-4 space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
                </div>
              ) : items && (items as unknown[]).length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {(items as Record<string, unknown>[]).map((item, i) => (
                    <div key={i} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-800">
                          {item.item_name as string || item.name as string}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {item.item_group as string} · {item.stock_uom as string}
                        </div>
                      </div>
                      <div className="text-left">
                        {(item.standard_rate as number) > 0 && (
                          <div className="text-sm font-semibold text-navy-hero">
                            {(item.standard_rate as number).toFixed(2)}
                          </div>
                        )}
                        <div className="flex gap-1 mt-0.5">
                          {item.is_sales_item === 1 && (
                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">مبيعات</span>
                          )}
                          {item.is_purchase_item === 1 && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">مشتريات</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">لا توجد أصناف متاحة</p>
                </div>
              )}
            </div>

            {/* Journal Entries */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-navy-hero" />
                  <h2 className="font-semibold text-gray-800">القيود المحاسبية</h2>
                </div>
                {journalEntries.length > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                    {journalEntries.length} قيد
                  </span>
                )}
              </div>
              {journalLoading ? (
                <div className="p-4 space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
                </div>
              ) : journalError ? (
                <div className="p-6 flex items-start gap-3 text-amber-700 bg-amber-50">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-medium text-sm">صلاحيات محدودة</div>
                    <p className="text-xs mt-1 text-amber-600">
                      يحتاج المستخدم دور "Accounts Manager" للوصول للقيود المحاسبية.
                    </p>
                  </div>
                </div>
              ) : journalEntries.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {(journalEntries as Record<string, unknown>[]).map((entry, i) => (
                    <div key={i} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-xs text-navy-hero font-semibold">{entry.name as string}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${entry.docstatus === 1 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {entry.docstatus === 1 ? "معتمد" : "مسودة"}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 mt-0.5">{entry.title as string || entry.voucher_type as string}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-gray-400">{entry.posting_date as string}</span>
                        <span className="text-xs font-medium text-navy-hero">
                          {(entry.total_debit as number)?.toFixed(2)} OMR
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-400">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">لا توجد قيود محاسبية بعد</p>
                  <p className="text-xs mt-1 text-gray-300">ستظهر القيود هنا عند إنشائها في النظام</p>
                </div>
              )}
            </div>
          </div>

          {/* Permissions Info */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-800 mb-2">ملاحظة حول الصلاحيات</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-medium text-green-700 mb-1">✅ البيانات المتاحة حالياً:</div>
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      <li>• معلومات الشركة (Company)</li>
                      <li>• شجرة الحسابات (Account)</li>
                      <li>• الأصناف والخدمات (Item)</li>
                      <li>• القيود المحاسبية (Journal Entry)</li>
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-red-600 mb-1">⚠️ يحتاج أدواراً إضافية:</div>
                    <ul className="text-xs text-gray-600 space-y-0.5">
                      <li>• العملاء (Customer) — Accounts Receivable User</li>
                      <li>• فواتير المبيعات (Sales Invoice) — Sales User</li>
                      <li>• الدفعات (Payment Entry) — Accounts Manager</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
