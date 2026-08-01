// ─── أدوات إدارة المنصة ──────────────────────────────────────────────────────
//
// الوكيل كان يرى نظام ERP الخاص بالعميل وحده. هذه الأدوات تجعله يرى **المنصة**
// أيضاً: من اشترك، ومن ينتظر تفعيلاً، وكم الإيراد، وإنشاء كوبون.
//
// **لا منطق جديد هنا.** كل أداة تستدعي إجراء الإدارة القائم عبر createCaller،
// فتسري عليها نفس الفحوص: التحقق من الدور، وسجل التدقيق، وقواعد الكوبون. لو
// كُتب استعلامٌ مباشر على القاعدة لتجاوز ذلك كله بلا أن يلاحظ أحد.
//
// **الحد الفاصل:** هذه أدوات المسؤول لا العميل. تُضاف لقائمة الأدوات فقط حين
// يكون الطالب admin — وقد قُرئ دوره من قاعدة البيانات لا من رسالة الطلب.

import type { User } from "../../drizzle/schema";

/** أدوات تُغيّر حالة — تحتاج تأكيداً صريحاً قبل التنفيذ */
export const PLATFORM_WRITE_TOOLS = new Set([
  "platform_activate_subscription",
  "platform_grant_credits",
  "platform_extend_subscription",
  "platform_create_coupon",
  "platform_set_coupon_active",
  "platform_set_user_active",
  "platform_set_lead_status",
]);

export const PLATFORM_TOOLS = [
  // ── قراءة ───────────────────────────────────────────────────────────────
  {
    type: "function" as const,
    function: {
      name: "platform_users",
      description: "قائمة مستخدمي المنصة (عملاء المعاصر) مع بريدهم ودورهم وحالتهم. استخدمها لمعرفة معرّف المستخدم قبل أي عملية عليه.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_subscriptions",
      description: "اشتراكات المنصة: الباقة والحالة وتاريخ التجديد ورصيد النقاط لكل عميل.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_revenue",
      description: "ملخص إيراد المنصة: المحصَّل والضريبة المحصلة والصافي. الضريبة ليست إيراداً.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_usage",
      description: "استهلاك العملاء: عدد الرسائل والمستندات والنقاط المستهلكة.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_insights",
      description: "مؤشرات المنصة: التسجيلات والاشتراكات النشطة والتجارب وما يقارب الانتهاء.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_leads",
      description: "العملاء المحتملون من شات المبيعات: الاسم والجوال والمدينة والنشاط والحالة.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_coupons",
      description: "كوبونات الخصم القائمة وشروطها وعدد مرات استخدامها.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_llm_cost",
      description: "تكلفة نماذج الذكاء الاصطناعي على المنصة — ما ندفعه نحن لا ما نحصّله.",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    },
  },

  // ── كتابة ───────────────────────────────────────────────────────────────
  {
    type: "function" as const,
    function: {
      name: "platform_activate_subscription",
      description: "تفعيل اشتراك عميل على باقة. يبدأ دورة فوترة جديدة. اطلب تأكيد المستخدم قبل الاستدعاء.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "number", description: "معرّف المستخدم من platform_users" },
          planId: { type: "number", description: "1=الأساسية 2=الاحترافية 3=المؤسسية 4=خبير ERP" },
          billing: { type: "string", enum: ["monthly", "yearly"], description: "دورة الفوترة" },
        },
        required: ["userId", "planId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_grant_credits",
      description: "منح نقاط إضافية لعميل بلا دفع. اطلب تأكيد المستخدم قبل الاستدعاء.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "number" },
          credits: { type: "number", description: "عدد النقاط الموجب" },
          note: { type: "string", description: "سبب المنح — يظهر في سجل الحركات" },
        },
        required: ["userId", "credits"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_extend_subscription",
      description: "تمديد اشتراك عميل بعدد أيام خارج دورة الباقة. اطلب تأكيد المستخدم قبل الاستدعاء.",
      parameters: {
        type: "object",
        properties: {
          userId: { type: "number" },
          days: { type: "number", description: "عدد الأيام (1 إلى 365)" },
          note: { type: "string" },
        },
        required: ["userId", "days"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_create_coupon",
      description: "إنشاء كوبون خصم. اعرض الشروط على المستخدم واطلب تأكيده قبل الاستدعاء.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "رمز الكوبون بالإنجليزية" },
          type: { type: "string", enum: ["percent", "fixed"], description: "نسبة مئوية أو مبلغ ثابت" },
          value: { type: "number", description: "النسبة أو المبلغ بالريال" },
          scope: { type: "string", enum: ["subscription", "topup", "both"] },
          description: { type: "string" },
          maxUses: { type: "number", description: "أقصى عدد استخدامات إجمالاً" },
          maxUsesPerUser: { type: "number" },
          firstPurchaseOnly: { type: "boolean", description: "لأول عملية شراء فقط" },
          newAccountWithinDays: { type: "number", description: "للحسابات المسجلة خلال هذا العدد من الأيام" },
          minAmountSar: { type: "number" },
          planId: { type: "number", description: "قصره على باقة بعينها" },
          validUntil: { type: "string", description: "تاريخ الانتهاء YYYY-MM-DD" },
        },
        required: ["code", "type", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_set_coupon_active",
      description: "تفعيل أو تعطيل كوبون قائم.",
      parameters: {
        type: "object",
        properties: { id: { type: "number" }, isActive: { type: "boolean" } },
        required: ["id", "isActive"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_set_user_active",
      description: "تفعيل أو إيقاف حساب عميل. الإيقاف يمنعه من الدخول. اطلب تأكيداً صريحاً.",
      parameters: {
        type: "object",
        properties: { userId: { type: "number" }, isActive: { type: "boolean" } },
        required: ["userId", "isActive"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "platform_set_lead_status",
      description: "تغيير حالة عميل محتمل — يوقف تذكيره اليومي.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" },
          status: { type: "string", enum: ["new", "contacted", "converted", "declined"] },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
    },
  },
];

export const PLATFORM_TOOL_NAMES = new Set(PLATFORM_TOOLS.map(t => t.function.name));

/** هل يُسمح لهذا المستخدم بأدوات المنصة؟ الدور من القاعدة لا من الطلب. */
export function canUsePlatformTools(user: Pick<User, "role">): boolean {
  return user.role === "admin";
}

type AdminCaller = {
  admin: Record<string, (input?: unknown) => Promise<unknown>>;
};

/**
 * تنفيذ أداة منصة عبر إجراء الإدارة نفسه.
 *
 * الاستدعاء بالـcaller لا بالقاعدة مباشرة: الإجراءات تتحقق من الدور وتكتب في
 * سجل التدقيق وتطبّق قواعد الكوبون. تجاوزها يعني عملية بلا أثر يُراجَع.
 */
export async function executePlatformTool(
  name: string,
  args: Record<string, unknown>,
  caller: AdminCaller,
): Promise<{ result: unknown; display: string }> {
  const call = async (proc: string, input?: unknown) => {
    const fn = caller.admin[proc];
    if (typeof fn !== "function") throw new Error(`إجراء الإدارة ${proc} غير متاح`);
    return fn(input);
  };

  switch (name) {
    case "platform_users":         return wrap(await call("users"), "مستخدمو المنصة");
    case "platform_subscriptions": return wrap(await call("subscriptions"), "الاشتراكات");
    case "platform_revenue":       return wrap(await call("revenueSummary"), "ملخص الإيراد");
    case "platform_usage":         return wrap(await call("usageSummary"), "الاستهلاك");
    case "platform_insights":      return wrap(await call("platformInsights"), "مؤشرات المنصة");
    case "platform_leads":         return wrap(await call("leads"), "العملاء المحتملون");
    case "platform_coupons":       return wrap(await call("coupons"), "الكوبونات");
    case "platform_llm_cost":      return wrap(await call("llmCostSummary"), "تكلفة النماذج");

    case "platform_activate_subscription":
      return wrap(await call("activateSubscription", {
        userId: num(args.userId), planId: num(args.planId),
        billing: (args.billing as string) === "yearly" ? "yearly" : "monthly",
      }), "تفعيل اشتراك");

    case "platform_grant_credits":
      return wrap(await call("grantCredits", {
        userId: num(args.userId), credits: num(args.credits), note: str(args.note),
      }), "منح نقاط");

    case "platform_extend_subscription":
      return wrap(await call("extendSubscriptionDays", {
        userId: num(args.userId), days: num(args.days), note: str(args.note),
      }), "تمديد اشتراك");

    case "platform_create_coupon":
      return wrap(await call("createCoupon", stripUndefined({
        code: str(args.code), type: args.type, value: num(args.value),
        scope: args.scope ?? "both", description: str(args.description),
        maxUses: optNum(args.maxUses), maxUsesPerUser: optNum(args.maxUsesPerUser),
        firstPurchaseOnly: args.firstPurchaseOnly === true,
        newAccountWithinDays: optNum(args.newAccountWithinDays),
        minAmountSar: optNum(args.minAmountSar), planId: optNum(args.planId),
        validUntil: str(args.validUntil),
      })), "إنشاء كوبون");

    case "platform_set_coupon_active":
      return wrap(await call("setCouponActive", { id: num(args.id), isActive: args.isActive === true }), "حالة كوبون");

    case "platform_set_user_active":
      return wrap(await call("setUserActive", { userId: num(args.userId), isActive: args.isActive === true }), "حالة حساب");

    case "platform_set_lead_status":
      return wrap(await call("setLeadStatus", { id: num(args.id), status: args.status }), "حالة عميل محتمل");

    default:
      throw new Error(`أداة منصة غير معروفة: ${name}`);
  }
}

const num = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("قيمة رقمية مطلوبة وغير صحيحة");
  return n;
};
const optNum = (v: unknown): number | undefined => (v === undefined || v === null ? undefined : num(v));
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const stripUndefined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function wrap(result: unknown, label: string): { result: unknown; display: string } {
  return { result, display: label };
}
