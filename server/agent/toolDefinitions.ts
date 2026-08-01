// ─── تعريفات أدوات الوكيل ────────────────────────────────────────────────────
// بيانات خالصة: ما يراه النموذج من أدوات وأسمائها ومعاملاتها. لا منطق هنا،
// ولذلك يصلح أن يُقرأ ويُراجَع كعقد — وأي تغيير فيه تغيير في قدرات الوكيل.
export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_invoices",
      description: "جلب قائمة فواتير المبيعات من ERPNext مع إمكانية الفلترة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الفواتير (افتراضي 10)" },
          status: { type: "string", enum: ["Paid", "Unpaid", "Overdue", "Draft", "Cancelled"], description: "فلترة حسب الحالة" },
          customer: { type: "string", description: "فلترة حسب اسم العميل" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_invoice_detail",
      description: "جلب تفاصيل فاتورة محددة بالكامل بما فيها الأصناف والمبالغ",
      parameters: {
        type: "object",
        properties: {
          invoice_name: { type: "string", description: "رقم الفاتورة مثل SINV-2024-00001" },
        },
        required: ["invoice_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_customers",
      description: "جلب قائمة العملاء أو البحث عن عميل بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي عميل جديد للتأكد من عدم وجوده مسبقاً",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد العملاء (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم العميل (جزء من الاسم يكفي)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_items",
      description: "جلب قائمة الأصناف والخدمات أو البحث عن صنف بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي صنف جديد للتأكد من عدم وجوده مسبقاً",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الأصناف (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم الصنف أو كوده (جزء من الاسم يكفي)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_invoice",
      description: "إنشاء فاتورة مبيعات جديدة في ERPNext كمسودة. تُحتسب ضريبة القيمة المضافة 15% تلقائياً وفق النظام السعودي ما لم يحدد المستخدم خلاف ذلك",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string", description: "اسم العميل (name field في ERPNext)" },
          items: {
            type: "array",
            description: "قائمة الأصناف",
            items: {
              type: "object",
              properties: {
                item_code: { type: "string", description: "كود الصنف" },
                qty: { type: "number", description: "الكمية" },
                rate: { type: "number", description: "السعر (قبل الضريبة)" },
              },
              required: ["item_code", "qty", "rate"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "تاريخ الاستحقاق بصيغة YYYY-MM-DD (اختياري)" },
          apply_vat: { type: "boolean", description: "احتساب ضريبة القيمة المضافة 15% (الافتراضي true). اجعلها false فقط إذا طلب المستخدم صراحةً فاتورة بدون ضريبة أو معفاة" },
        },
        required: ["customer", "items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_sales_report",
      description: "جلب تقرير ملخص المبيعات والإيرادات لفترة زمنية",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: ["this_month", "last_month", "this_year"], description: "الفترة الزمنية" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_customer",
      description: "إنشاء عميل جديد. لا تستخدمها أبداً قبل البحث بـ get_customers والتأكد من عدم وجود العميل — الأداة نفسها ترفض الإنشاء إذا وُجد عميل مطابق أو مشابه وتعيد قائمة المرشحين",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "اسم العميل" },
          customer_type: { type: "string", enum: ["Company", "Individual"], description: "نوع العميل: شركة أو فرد (الافتراضي Company)" },
          mobile_no: { type: "string", description: "رقم الجوال (اختياري)" },
          email_id: { type: "string", description: "البريد الإلكتروني (اختياري)" },
          tax_id: { type: "string", description: "الرقم الضريبي للعميل (15 رقماً يبدأ وينتهي بـ 3 وفق نظام ضريبة القيمة المضافة السعودي) — مطلوب للعملاء من نوع شركة/منشأة، اسأل المستخدم عنه عند إنشاء عميل شركة" },
        },
        required: ["customer_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_item",
      description: "إنشاء صنف/خدمة جديدة. لا تستخدمها أبداً قبل البحث بـ get_items والتأكد من عدم وجود الصنف — الأداة نفسها ترفض الإنشاء إذا وُجد صنف مطابق أو مشابه وتعيد قائمة المرشحين",
      parameters: {
        type: "object",
        properties: {
          item_name: { type: "string", description: "اسم الصنف أو الخدمة" },
          item_code: { type: "string", description: "كود الصنف (اختياري — يُستخدم الاسم إذا لم يُحدد)" },
          standard_rate: { type: "number", description: "سعر البيع الافتراضي (اختياري)" },
          is_service: { type: "boolean", description: "true إذا كان خدمة (غير مخزنية)، false إذا كان منتجاً مخزنياً. الافتراضي true" },
          item_group: { type: "string", description: "مجموعة الصنف (اختياري — الافتراضي: All Item Groups)" },
        },
        required: ["item_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_invoice",
      description: "اعتماد فاتورة مبيعات (Submit) لتسجيلها رسمياً في الحسابات. تُستخدم بعد إنشاء الفاتورة أو عند طلب المستخدم اعتماد فاتورة مسودة",
      parameters: {
        type: "object",
        properties: {
          invoice_name: { type: "string", description: "رقم الفاتورة مثل ACC-SINV-2026-00001" },
        },
        required: ["invoice_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_suppliers",
      description: "جلب قائمة الموردين أو البحث عن مورد بالاسم (بحث تقريبي). استخدمها دائماً قبل إنشاء أي مورد جديد",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الموردين (افتراضي 20)" },
          search: { type: "string", description: "بحث تقريبي باسم المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_supplier",
      description: "إنشاء مورد جديد. لا تستخدمها قبل البحث بـ get_suppliers — الأداة ترفض الإنشاء إذا وُجد مورد مشابه وتعيد المرشحين",
      parameters: {
        type: "object",
        properties: {
          supplier_name: { type: "string", description: "اسم المورد" },
          supplier_type: { type: "string", enum: ["Company", "Individual"], description: "نوع المورد (الافتراضي Company)" },
          mobile_no: { type: "string", description: "رقم الجوال (اختياري)" },
          email_id: { type: "string", description: "البريد الإلكتروني (اختياري)" },
        },
        required: ["supplier_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_purchase_invoices",
      description: "جلب قائمة فواتير المشتريات مع إمكانية الفلترة بالحالة أو المورد",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الفواتير (افتراضي 10)" },
          status: { type: "string", enum: ["Paid", "Unpaid", "Overdue", "Draft", "Cancelled"], description: "فلترة حسب الحالة" },
          supplier: { type: "string", description: "فلترة حسب اسم المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_purchase_invoice",
      description: "إنشاء فاتورة مشتريات من مورد كمسودة. تحقق من وجود المورد والأصناف أولاً (get_suppliers/get_items) — الأداة تحل الأسماء المشابهة تلقائياً",
      parameters: {
        type: "object",
        properties: {
          supplier: { type: "string", description: "اسم المورد" },
          items: {
            type: "array",
            description: "قائمة الأصناف المشتراة",
            items: {
              type: "object",
              properties: {
                item_code: { type: "string", description: "كود أو اسم الصنف" },
                qty: { type: "number", description: "الكمية" },
                rate: { type: "number", description: "سعر الشراء" },
              },
              required: ["item_code", "qty", "rate"],
              additionalProperties: false,
            },
          },
          due_date: { type: "string", description: "تاريخ الاستحقاق YYYY-MM-DD (اختياري)" },
        },
        required: ["supplier", "items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_payments",
      description: "جلب قائمة الدفعات (Payment Entries) المستلمة والمدفوعة مع إمكانية الفلترة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد الدفعات (افتراضي 10)" },
          payment_type: { type: "string", enum: ["Receive", "Pay"], description: "Receive = مستلمة من عميل، Pay = مدفوعة لمورد" },
          party: { type: "string", description: "فلترة حسب اسم العميل أو المورد" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_payment_entry",
      description: "تسجيل دفعة: مستلمة من عميل (Receive) أو مدفوعة لمورد (Pay). يمكن ربطها بفاتورة محددة لسدادها. تُنشأ كمسودة ثم تُعتمد بـ submit_document",
      parameters: {
        type: "object",
        properties: {
          payment_type: { type: "string", enum: ["Receive", "Pay"], description: "Receive = قبض من عميل، Pay = صرف لمورد" },
          party: { type: "string", description: "اسم العميل (لـ Receive) أو المورد (لـ Pay)" },
          amount: { type: "number", description: "مبلغ الدفعة" },
          reference_invoice: { type: "string", description: "رقم الفاتورة المراد سدادها مثل ACC-SINV-2026-00001 (اختياري — لربط الدفعة بالفاتورة)" },
          mode_of_payment: { type: "string", description: "طريقة الدفع مثل Cash أو Bank (اختياري)" },
        },
        required: ["payment_type", "party", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_accounts",
      description: "جلب شجرة الحسابات أو البحث عن حساب بالاسم — استخدمها قبل إنشاء قيد يومية لمعرفة أسماء الحسابات الفعلية",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "بحث باسم الحساب مثل Cash أو الصندوق أو المبيعات" },
          root_type: { type: "string", enum: ["Asset", "Liability", "Equity", "Income", "Expense"], description: "فلترة حسب التصنيف (اختياري)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_journal_entries",
      description: "جلب قيود اليومية المسجلة",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "عدد القيود (افتراضي 10)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_journal_entry",
      description: "تسجيل قيد يومية محاسبي (مدين/دائن). يجب أن يتساوى إجمالي المدين مع إجمالي الدائن. ابحث عن أسماء الحسابات الفعلية بـ get_accounts أولاً. يُنشأ كمسودة ثم يُعتمد بـ submit_document",
      parameters: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            description: "سطور القيد — كل سطر حساب مع مبلغ مدين أو دائن",
            items: {
              type: "object",
              properties: {
                account: { type: "string", description: "اسم الحساب الفعلي من شجرة الحسابات" },
                debit: { type: "number", description: "المبلغ المدين (0 إذا كان السطر دائناً)" },
                credit: { type: "number", description: "المبلغ الدائن (0 إذا كان السطر مديناً)" },
              },
              required: ["account", "debit", "credit"],
              additionalProperties: false,
            },
          },
          remark: { type: "string", description: "البيان / وصف القيد" },
          posting_date: { type: "string", description: "تاريخ القيد YYYY-MM-DD (اختياري — الافتراضي اليوم)" },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_document",
      description: "اعتماد (Submit) أي مستند لتسجيله رسمياً في الحسابات: فاتورة مبيعات، فاتورة مشتريات، دفعة، أو قيد يومية",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية كما في ERPNext — أي نوع مستند: Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, Customer, Supplier, Item, Delivery Note, Sales Order, Purchase Order, Purchase Receipt, Stock Entry, Quotation, Lead, Address, Contact, Warehouse, Cost Center — أو أي DocType آخر في النظام" },
          document_name: { type: "string", description: "رقم المستند مثل ACC-SINV-2026-00001 أو ACC-PAY-2026-00001" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_custom_field",
      description: "إضافة حقل مخصص إلى نوع مستند في نظام العميل (مثل حقل 'رقم أمر الشراء' على فاتورة المبيعات). إعداد لا حركة محاسبية. **لا تستدعِها قبل عرض التفاصيل على العميل وأخذ موافقته** — ترفض بلا confirmed: true",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "نوع المستند مثل Sales Invoice" },
          label: { type: "string", description: "التسمية الظاهرة للمستخدم" },
          fieldname: { type: "string", description: "الاسم البرمجي بحروف إنجليزية صغيرة وشرطات سفلية" },
          fieldtype: { type: "string", enum: ["Data", "Int", "Float", "Currency", "Date", "Datetime", "Select", "Check", "Small Text", "Text", "Link"], description: "نوع الحقل" },
          options: { type: "string", description: "لـ Select: الخيارات مفصولة بأسطر. لـ Link: اسم الدوكتايب المرتبط" },
          insert_after: { type: "string", description: "اسم الحقل الذي يظهر بعده" },
          reqd: { type: "boolean", description: "هل الحقل إلزامي" },
          confirmed: { type: "boolean", description: "true فقط بعد موافقة العميل الصريحة" },
        },
        required: ["doctype", "label", "fieldname", "fieldtype", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_print_format",
      description: "إنشاء نموذج طباعة مخصص لنوع مستند بصيغة HTML/Jinja. **اطلب من العميل أولاً شعاره أو ترويسته (letterhead) كصورة، واعرض عليه خيارات الخط** — النموذج بلا شعار وبلا خط عربي يبدو رديئاً على فاتورة تصل لعملائه. **لا تستدعِها قبل عرض التصميم على العميل وأخذ موافقته** — ترفض بلا confirmed: true. النموذج يُنشأ غير مفعّل افتراضياً حتى يعتمده العميل",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "نوع المستند مثل Sales Invoice" },
          name: { type: "string", description: "اسم النموذج" },
          html: { type: "string", description: "قالب Jinja/HTML كامل. استخدم doc.field للوصول للحقول" },
          css: { type: "string", description: "تنسيق CSS اختياري" },
          font: { type: "string", enum: ["Cairo", "Tajawal", "IBM Plex Sans Arabic", "Almarai", "Noto Naskh Arabic"], description: "خط عربي للنموذج — Cairo واضح وعملي للفواتير، Tajawal أنعم، Almarai أعرض، Noto Naskh تقليدي" },
          letterhead_url: { type: "string", description: "رابط صورة الترويسة أو الشعار الذي أرسله العميل (رابط ملف في نظامه مثل /files/logo.png) — يوضع خلفية للنموذج" },
          confirmed: { type: "boolean", description: "true فقط بعد موافقة العميل الصريحة" },
        },
        required: ["doctype", "name", "html", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_custom_app",
      description: "تسجيل طلب عميل لتطبيق أو تخصيص برمجي على نظامه، وإبلاغ إدارة المنصة به. استدعها متى طلب العميل ميزة أو تطبيقاً غير موجود في النظام. **لا تَعِد العميل بسعر ولا بموعد تسليم ولا تقل إن التطبيق جاهز** — أبلغه فقط أن الطلب سُجّل وأن الإدارة ستتواصل معه",
      parameters: {
        type: "object",
        properties: {
          request: { type: "string", description: "وصف ما يطلبه العميل بالتفصيل كما فهمته منه" },
        },
        required: ["request"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_customer",
      description: "تحديث بيانات عميل قائم: الرقم الضريبي، نوعه (شركة/فرد)، وعنوانه. استخدمها عند رفض إنشاء فاتورة بسبب customer_data_incomplete — اطلب الناقص من المستخدم أولاً ثم سجّله هنا. الرقم الضريبي يُفحص شكلياً ويُرفض إن كانت صيغته خاطئة",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string", description: "اسم العميل كما هو في النظام" },
          tax_id: { type: "string", description: "الرقم الضريبي — اتركه فارغاً لعدم تغييره" },
          customer_type: { type: "string", enum: ["Company", "Individual"], description: "نوع العميل" },
          address_line1: { type: "string", description: "الشارع/المبنى" },
          city: { type: "string", description: "المدينة" },
          country: { type: "string", description: "الدولة" },
          pincode: { type: "string", description: "الرمز البريدي" },
        },
        required: ["customer"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_report",
      description: "حفظ تقرير رسمي في حساب العميل (تقييم نظام، بنود استلام، مراجعة عقد، سياسات، تصميم دورة عمل). استدعها بعد أن تكتب التقرير كاملاً في المحادثة — الحفظ يجعله مستنداً يُفتح لاحقاً ويُراجع، ويُشعر إدارة المنصة. التقرير يُحفظ بانتظار مراجعة العميل",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["system_assessment", "handover_terms", "contract_review", "policies", "workflow_design", "other"], description: "نوع التقرير" },
          title: { type: "string", description: "عنوان واضح يميّزه لاحقاً" },
          content: { type: "string", description: "نص التقرير كاملاً بصيغة Markdown، بأقسامه الثلاثة: فُحص / لم يُفحص / يحتاج قراراً بشرياً" },
        },
        required: ["kind", "title", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_workflow_options",
      description: "قراءة الحالات والإجراءات والأدوار المتاحة في نظام العميل لبناء دورة عمل. **استدعها دائماً قبل create_workflow** — أسماء الحالات والإجراءات روابط لسجلات قائمة، واختراع اسم غير موجود يُفشل الإنشاء",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_workflows",
      description: "عرض دورات العمل (Workflows) المعرّفة في نظام العميل، اختيارياً لنوع مستند بعينه. استخدمها عند تقييم النظام أو قبل اقتراح دورة جديدة",
      parameters: {
        type: "object",
        properties: { document_type: { type: "string", description: "نوع المستند مثل Sales Invoice — اتركه فارغاً لعرض الكل" } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_workflow",
      description: "إنشاء دورة عمل (Workflow) لنوع مستند: حالات وانتقالات وأدوار الموافقة. إعداد نظام لا حركة محاسبية. **لا تستدعِها قبل عرض التصميم على العميل والحصول على موافقته الصريحة** — ترفض التنفيذ إن لم تُمرّر confirmed: true",
      parameters: {
        type: "object",
        properties: {
          workflow_name: { type: "string", description: "اسم دورة العمل" },
          document_type: { type: "string", description: "نوع المستند مثل Sales Invoice" },
          states: {
            type: "array",
            description: "الحالات بالترتيب",
            items: {
              type: "object",
              properties: {
                state: { type: "string", description: "اسم الحالة" },
                allow_edit: { type: "string", description: "الدور الذي يملك التعديل في هذه الحالة" },
                doc_status: { type: "string", enum: ["0", "1", "2"], description: "0 مسودة، 1 مُرحّل، 2 ملغى" },
              },
              required: ["state", "allow_edit", "doc_status"],
              additionalProperties: false,
            },
          },
          transitions: {
            type: "array",
            description: "الانتقالات بين الحالات",
            items: {
              type: "object",
              properties: {
                state: { type: "string", description: "الحالة الحالية" },
                action: { type: "string", description: "اسم الإجراء" },
                next_state: { type: "string", description: "الحالة التالية" },
                allowed: { type: "string", description: "الدور المسموح له بالإجراء" },
              },
              required: ["state", "action", "next_state", "allowed"],
              additionalProperties: false,
            },
          },
          confirmed: { type: "boolean", description: "true فقط بعد موافقة العميل الصريحة على التصميم" },
        },
        required: ["workflow_name", "document_type", "states", "transitions", "confirmed"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_tax_setup",
      description: "فحص إعدادات الضريبة في نظام العميل (قالب ضريبة المبيعات + الرقم الضريبي للشركة). استخدمها في بداية التعامل مع عميل جديد أو عند أي شك، وأبلغ العميل بنتيجتها إن كان هناك نقص",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "setup_tax_settings",
      description: "ضبط إعدادات الضريبة للعميل: إنشاء قالب ضريبة مبيعات افتراضي بالنسبة المطلوبة و/أو تسجيل الرقم الضريبي للشركة. **لا تستدعِها أبداً قبل أن تُبلغ العميل بما هو ناقص وتحصل على موافقته الصريحة** — الأداة ترفض التنفيذ إن لم تُمرّر confirmed: true",
      parameters: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "اجعلها true فقط بعد أن يوافق العميل صراحةً على أن تضبط له إعدادات الضريبة" },
          rate: { type: "number", description: "نسبة الضريبة المئوية (15 للسعودية، 14 لمصر، 5 للإمارات... اسأل العميل إن لم تكن متأكداً)" },
          company_tax_id: { type: "string", description: "الرقم الضريبي للشركة (البائع) إن كان ناقصاً وأعطاه العميل" },
          account_head: { type: "string", description: "اسم الحساب الضريبي في شجرة الحسابات (اختياري — يُحل تلقائياً إن تُرك فارغاً)" },
        },
        required: ["confirmed", "rate"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "print_document",
      description: "استخدمها دائماً عندما يطلب العميل طباعة أو تنزيل PDF أو إرسال نسخة من أي مستند موجود بالفعل (فاتورة مبيعات، فاتورة مشتريات، دفعة، أو قيد يومية). تعرض للعميل زر تحميل PDF فوري بنموذج الطباعة الفعلي المُعدّ في نظامه. لا ترفض طلب الطباعة أبداً — استخدم هذه الأداة دوماً بدل الاعتذار",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية كما في ERPNext — أي نوع مستند: Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, Customer, Supplier, Item, Delivery Note, Sales Order, Purchase Order, Purchase Receipt, Stock Entry, Quotation, Lead, Address, Contact, Warehouse, Cost Center — أو أي DocType آخر في النظام" },
          document_name: { type: "string", description: "رقم المستند مثل ACC-SINV-2026-00001 أو ACC-PAY-2026-00001" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_document",
      description: "تعديل أي مستند أو سجل في النظام: فاتورة (مسودة فقط)، عميل، مورد، صنف، قيد يومية (مسودة)، دفعة (مسودة). مرر الحقول المراد تغييرها فقط في fields. المستندات المعتمدة (docstatus=1) لا يمكن تعديلها — يجب إلغاؤها أولاً بـ cancel_document ثم إنشاء بديل، أما العملاء/الموردين/الأصناف فتُعدَّل مباشرة في أي وقت",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية كما في ERPNext — أي نوع مستند: Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, Customer, Supplier, Item, Delivery Note, Sales Order, Purchase Order, Purchase Receipt, Stock Entry, Quotation, Lead, Address, Contact, Warehouse, Cost Center — أو أي DocType آخر في النظام" },
          document_name: { type: "string", description: "معرّف المستند: رقم الفاتورة أو اسم العميل/المورد/الصنف كما هو في النظام" },
          fields: {
            type: "object",
            description: "الحقول المراد تعديلها بصيغة ERPNext، مثل: {\"customer_name\": \"الاسم الجديد\"} أو {\"mobile_no\": \"0555...\"} أو {\"standard_rate\": 150} أو {\"due_date\": \"2026-08-01\"}",
            additionalProperties: true,
          },
        },
        required: ["doctype", "document_name", "fields"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_document",
      description: "إلغاء (Cancel) مستند معتمد: فاتورة مبيعات/مشتريات، دفعة، أو قيد يومية. الإلغاء يعكس أثر المستند على الحسابات. مطلوب قبل حذف أي مستند معتمد",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية كما في ERPNext — أي نوع مستند: Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, Customer, Supplier, Item, Delivery Note, Sales Order, Purchase Order, Purchase Receipt, Stock Entry, Quotation, Lead, Address, Contact, Warehouse, Cost Center — أو أي DocType آخر في النظام" },
          document_name: { type: "string", description: "رقم المستند المعتمد" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_documents",
      description: "سرد سجلات أي DocType في النظام مع مرشّحات. استخدمها قبل الحذف لمعرفة ما يرتبط بالسجل: حذف عميل يفشل إن كان له إشعار تسليم أو أمر بيع، وهذه الأداة تكشفها. أمثلة: قائمة إشعارات التسليم لعميل، أوامر البيع المفتوحة، السجلات المرتبطة بأي مستند.",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية — Delivery Note أو Sales Order أو أي نوع آخر" },
          filters: {
            type: "object",
            description: "مرشّحات كأزواج حقل=قيمة، مثل {\"customer\": \"CUST-0001\"} أو {\"docstatus\": 1}",
            additionalProperties: true,
          },
          fields: { type: "array", items: { type: "string" }, description: "الحقول المطلوبة — الافتراضي name فقط" },
          limit: { type: "number", description: "أقصى عدد سجلات (الافتراضي 20)" },
        },
        required: ["doctype"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_with_dependencies",
      description: "حذف سجل مع كل ما يمنع حذفه، بالترتيب الصحيح تلقائياً. استخدمها بدل delete_document حين يكون للسجل مستندات مرتبطة (عميل له إشعارات تسليم أو أوامر بيع). لا تبحث عن المرتبطات بنفسك — هذه الأداة تتبع سلسلة الارتباط من رسائل النظام نفسها. **تتطلب موافقة صريحة من المستخدم**: اعرض عليه أنك ستحذف السجل وكل المرتبط به نهائياً، وبعد موافقته استدعها بـ confirmed: true. الحذف لا يمكن التراجع عنه.",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "نوع السجل الأصلي — Customer مثلاً" },
          document_name: { type: "string", description: "اسم السجل" },
          confirmed: { type: "boolean", description: "true بعد موافقة المستخدم الصريحة على الحذف النهائي" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_document",
      description: "حذف نهائي لأي مستند أو سجل: فاتورة، عميل، مورد، صنف، قيد، دفعة. المستند المعتمد يُلغى تلقائياً أولاً ثم يُحذف. تحذير: الحذف نهائي ولا يمكن التراجع عنه — اطلب تأكيد المستخدم دائماً قبل التنفيذ",
      parameters: {
        type: "object",
        properties: {
          doctype: { type: "string", description: "اسم DocType بالإنجليزية كما في ERPNext — أي نوع مستند: Sales Invoice, Purchase Invoice, Payment Entry, Journal Entry, Customer, Supplier, Item, Delivery Note, Sales Order, Purchase Order, Purchase Receipt, Stock Entry, Quotation, Lead, Address, Contact, Warehouse, Cost Center — أو أي DocType آخر في النظام" },
          document_name: { type: "string", description: "معرّف المستند المراد حذفه" },
        },
        required: ["doctype", "document_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_settings",
      description: "قراءة إعدادات النظام لأي DocType إعدادات في ERPNext: بيانات الشركة، إعدادات البيع/الشراء/المخزون/الحسابات/النظام، قوالب الضرائب، طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق، POS Profile، شروط الدفع، السنة المالية، مراكز التكلفة، المستودعات، وغيرها. استخدمها لفهم الإعدادات الحالية قبل أي تعديل",
      parameters: {
        type: "object",
        properties: {
          settings_type: {
            type: "string",
            description: "اسم DocType الإعدادات بالإنجليزية كما في ERPNext. أمثلة: Company, Selling Settings, Buying Settings, Stock Settings, Accounts Settings, System Settings, Global Defaults, Sales Taxes and Charges Template, Purchase Taxes and Charges Template, Mode of Payment, POS Profile, Payment Terms Template, Fiscal Year, Cost Center, Warehouse, Currency Exchange, Print Settings — أو أي DocType آخر",
          },
          name: { type: "string", description: "اسم السجل المحدد (مطلوب للشركة أو قالب ضريبة محدد — اتركه فارغاً لجلب القائمة أو الإعدادات العامة)" },
        },
        required: ["settings_type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_settings",
      description: "تعديل إعدادات النظام لأي DocType إعدادات في ERPNext ضمن صلاحيات المستخدم المتصل: بيانات الشركة، إعدادات الموديولات، قوالب الضرائب، طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق عبر الحقل accounts (جدول فرعي: [{company, default_account}])، POS Profile، شروط الدفع، وغيرها. اقرأ الإعدادات بـ get_settings أولاً، ولخّص للمستخدم ما ستغيّره قبل التنفيذ. لا ترفض أي طلب إعدادات استباقياً — نفّذه وإن رفضه ERPNext انقل رسالة الخطأ",
      parameters: {
        type: "object",
        properties: {
          settings_type: {
            type: "string",
            description: "اسم DocType الإعدادات بالإنجليزية كما في ERPNext. أمثلة: Company, Selling Settings, Accounts Settings, Mode of Payment, POS Profile, Payment Terms Template, Sales Taxes and Charges Template — أو أي DocType آخر",
          },
          name: { type: "string", description: "اسم السجل المحدد (مطلوب للشركة أو قالب ضريبة — اتركه فارغاً لمستندات الإعدادات الفردية مثل Selling Settings)" },
          fields: {
            type: "object",
            description: "الحقول المراد تعديلها وقيمها الجديدة، مثل {\"tax_id\": \"310000000000003\"} أو للجداول الفرعية مثل ربط طريقة دفع بحساب: {\"accounts\": [{\"company\": \"اسم الشركة\", \"default_account\": \"اسم الحساب\"}]}",
            additionalProperties: true,
          },
        },
        required: ["settings_type", "fields"],
        additionalProperties: false,
      },
    },
  },
];
