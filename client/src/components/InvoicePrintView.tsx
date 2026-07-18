import { trpc } from "@/lib/trpc";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Phone, Mail, MapPin, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const APP_LOGO = "/manus-storage/logo_icon_ba8a6fa6.png";

/**
 * معاينة طباعة الفاتورة الضريبية السعودية — مصممة وفق نموذج المستخدم:
 * ترويسة (شعار + اسم شركة)، عنوان "فاتورة ضريبية" + VAT، صف بيانات العميل،
 * جدول أصناف، ملخص مبالغ مع QR (ZATCA TLV)، تذييل تواصل بلمسات كحلية منحنية.
 */
export default function InvoicePrintView({ invoiceName, onClose }: { invoiceName: string; onClose: () => void }) {
  const { data, isLoading, error } = trpc.erpnext.getInvoicePrintData.useQuery({ invoiceName });

  const print = () => {
    const el = document.getElementById("invoice-print-area");
    if (!el) return;
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${invoiceName}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap');
        *{margin:0;padding:0;box-sizing:border-box;font-family:'IBM Plex Sans Arabic',sans-serif}
        body{background:#fff;color:#1a2744}
        @media print{ @page{size:A4;margin:0} body{-webkit-print-color-adjust:exact;print-color-adjust:exact} }
      </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full my-4" onClick={e => e.stopPropagation()}>
        {/* شريط الأدوات */}
        <div className="flex items-center justify-between p-3 border-b bg-gray-50 rounded-t-xl print:hidden">
          <div className="flex gap-2">
            <Button size="sm" onClick={print} className="gap-1.5 bg-[#1a2744] hover:bg-[#243356] text-white">
              <Printer className="w-4 h-4" /> طباعة / PDF
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> جارٍ تحميل الفاتورة...
          </div>
        )}
        {error && <div className="p-8 text-center text-sm text-red-600">تعذّر تحميل الفاتورة: {error.message}</div>}

        {data && (
          <div id="invoice-print-area">
            <div dir="rtl" style={{ position: "relative", background: "#fff", color: "#1a2744", padding: "0", overflow: "hidden", minHeight: "1050px", display: "flex", flexDirection: "column" }}>
              {/* الزخرفة العلوية المنحنية */}
              <div style={{ position: "absolute", top: 0, right: 0, width: "45%", height: "70px", background: "linear-gradient(135deg,#1a2744,#2d4a7a)", borderBottomLeftRadius: "60px" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, width: "38%", height: "60px", background: "linear-gradient(135deg,#2d4a7a,#1a2744)", borderTopRightRadius: "60px" }} />

              {/* الترويسة */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "28px 36px 8px", position: "relative" }}>
                <div style={{ paddingTop: "20px", textAlign: "right" }}>
                  <p style={{ fontWeight: 700, fontSize: "17px", color: "#fff", position: "relative", zIndex: 1, paddingLeft: "12px" }}>{data.company.name}</p>
                </div>
                <div style={{ textAlign: "center" }}>
                  <img src={APP_LOGO} alt="Logo" style={{ width: "64px", height: "64px", objectFit: "contain" }} />
                  <p style={{ fontWeight: 700, fontSize: "15px", marginTop: "4px", color: "#1a2744" }}>Almoaser AI ERP</p>
                </div>
              </div>

              {/* العنوان */}
              <div style={{ textAlign: "center", marginTop: "24px" }}>
                <h1 style={{ fontSize: "26px", fontWeight: 700 }}>فاتورة ضريبية</h1>
                {data.company.taxId && <p style={{ fontSize: "15px", marginTop: "4px", direction: "ltr" }}>VAT: {data.company.taxId}</p>}
                <p style={{ fontSize: "16px", marginTop: "10px", fontWeight: 600, direction: "ltr" }}>{data.invoice.name}</p>
              </div>

              {/* صف بيانات العميل */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", padding: "26px 36px 0", textAlign: "center" }}>
                {[
                  { label: "اسم العميل", value: data.customer.name },
                  { label: "رقم التسجيل الضريبي", value: data.customer.taxId || "—" },
                  { label: "عنوان العميل", value: data.customer.address ? data.customer.address.replace(/<br\s*\/?>/g, "، ") : "—" },
                  { label: "تاريخ الفاتورة", value: data.invoice.postingDate },
                ].map((c, i) => (
                  <div key={i}>
                    <p style={{ fontWeight: 700, fontSize: "13.5px", marginBottom: "10px" }}>{c.label}</p>
                    <p style={{ fontSize: "12.5px", lineHeight: 1.7 }}>{c.value}</p>
                  </div>
                ))}
              </div>

              {/* جدول الأصناف مع علامة مائية */}
              <div style={{ padding: "28px 36px 0", position: "relative" }}>
                <img src={APP_LOGO} alt="" style={{ position: "absolute", inset: 0, margin: "auto", width: "260px", opacity: 0.06, pointerEvents: "none" }} />
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", position: "relative" }}>
                  <thead>
                    <tr>
                      {["س", "الخدمة", "الوحدة", "العدد", "السعر", "الإجمالي"].map((h, i) => (
                        <th key={i} style={{ border: "1px solid #1a2744", padding: "9px 6px", fontWeight: 700, background: "#f7f9fc", width: i === 0 ? "6%" : i === 1 ? "44%" : undefined }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.invoice.items.map((it, i) => (
                      <tr key={i}>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 6px", textAlign: "center" }}>{i + 1}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 10px" }}>{it.itemName}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 6px", textAlign: "center" }}>{it.uom}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 6px", textAlign: "center" }}>{it.qty}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 6px", textAlign: "center" }}>{fmt(it.rate)}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "9px 6px", textAlign: "center" }}>{fmt(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ملخص المبالغ + QR */}
              <div style={{ display: "flex", gap: "18px", padding: "26px 36px 0", alignItems: "stretch" }}>
                {/* QR */}
                <div style={{ width: "30%", border: "1px solid #1a2744", display: "flex", alignItems: "center", justifyContent: "center", padding: "14px" }}>
                  <QRCodeSVG value={data.qrBase64} size={150} level="M" />
                </div>
                {/* جدول الملخص */}
                <table style={{ flex: 1, borderCollapse: "collapse", fontSize: "13px" }}>
                  <tbody>
                    {[
                      { label: "الإجمالي غير شامل الضريبة :", value: `${fmt(data.invoice.netTotal)} ر.س` },
                      { label: "الخصم :", value: `${fmt(data.invoice.discountAmount)} ر.س` },
                      { label: "الضريبة :", value: `${fmt(data.invoice.totalTaxes)} ر.س` },
                      { label: "المجموع الإجمالي :", value: `${fmt(data.invoice.grandTotal)} ر.س`, bold: true },
                      { label: "ملاحظات", value: data.invoice.remarks || "" },
                    ].map((r, i) => (
                      <tr key={i}>
                        <td style={{ border: "1px solid #1a2744", padding: "10px 14px", fontWeight: 700, width: "45%" }}>{r.label}</td>
                        <td style={{ border: "1px solid #1a2744", padding: "10px 14px", textAlign: "center", fontWeight: r.bold ? 700 : 400 }}>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* التذييل */}
              <div style={{ marginTop: "auto", padding: "30px 36px 26px", display: "flex", justifyContent: "center", gap: "36px", fontSize: "11.5px", position: "relative", zIndex: 1 }}>
                {data.company.phone && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Phone size={13} color="#2d4a7a" /> <span dir="ltr">{data.company.phone}</span>
                  </span>
                )}
                {data.company.email && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    <Mail size={13} color="#2d4a7a" /> <span dir="ltr">{data.company.email}</span>
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <MapPin size={13} color="#2d4a7a" /> {data.company.country || "Saudi Arabia"}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
