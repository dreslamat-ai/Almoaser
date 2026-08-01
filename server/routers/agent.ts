/**
 * ERPNext AI Agent — Function Calling Router
 *
 * الراوتر وحده: يستقبل الطلب، يحسب الصلاحيات والنقاط، يبني رسالة النظام، ويدير
 * دورة النموذج والأدوات. ما عداه انتقل إلى server/agent/ — التعريفات والمنفّذ
 * وعميل ERP والصلاحيات — كي يبقى هذا الملف قابلاً للقراءة كاملاً.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { invokeAgentLLM } from "../llmProvider";
import { logLlmUsage } from "../llmUsage";
import { storagePut, storageGetSignedUrl } from "../storage";
import { transcribeAudio } from "../_core/voiceTranscription";
import { getErpConfigForUser, type ErpConfig } from "../erpConnection";
import { notifyUser, notifyAdmins } from "../notifications";
import { buildExpertSkillsSection } from "./agentPersona";
import type { User } from "../../drizzle/schema";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { trimHistory, messageCreditCost, MAX_MESSAGE_CHARS, MAX_MESSAGES } from "../../shared/chatLimits";
import { identityLineFor, modeRulesFor, toolsForSubscriptions, resolveCapabilities, type AgentMode } from "../agentModes";


// ── من الوحدات المستخرجة
import { toolsForUser, canUseTool, requireToolPermission, narrowToolsByErpPermissions } from "../agent/toolPermissions";
import { runWithErpConfig, erpGET, erpBaseUrl, currentErpConfig, getSession } from "../agent/erpClient";
import { extractQuickReplies } from "../agent/quickReplies";
import { TOOLS } from "../agent/toolDefinitions";
import { executeTool } from "../agent/executeTool";
import { executeOdooTool } from "../odooTools";
import { translateErpError, getDefaultCompany, submitDoc } from "../agent/erpHelpers";
import { resolvePrintFormatCandidates } from "../agent/printFormats";

// ─── Agent Router ─────────────────────────────────────────────────────────────
export const agentRouter = router({
  chat: protectedProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      messages: z.array(z.object({
        role: z.enum(["user", "assistant", "tool"]),
        // المتصفح يرسل التاريخ كاملاً والخصم نقطة واحدة مهما كبر، فبلا سقف
        // يستطيع أي عميل تحميل الحساب تكلفة نموذج ضخمة مقابل نقطة.
        content: z.string().max(MAX_MESSAGE_CHARS, `أقصى طول للرسالة ${MAX_MESSAGE_CHARS} حرف`),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.object({
          id: z.string(),
          type: z.literal("function"),
          function: z.object({ name: z.string(), arguments: z.string() }),
        })).optional(),
      })).max(MAX_MESSAGES, "المحادثة طويلة جداً — ابدأ محادثة جديدة"),
    }))
    .mutation(async ({ input, ctx }) => {
      // ─── خصم رصيد الرسالة — من رصيد المنظمة المشترك ───
      // الرسالة الطويلة بنقطتين: التكلفة الفعلية يحكمها البرومبت الثابت لا نص
      // العميل، لكن السقف يمنع أن تمر رسالة ضخمة بسعر رسالة عادية.
      const credits = await import("../credits");
      const lastUserContent = [...input.messages].reverse().find(m => m.role === "user")?.content ?? "";
      const messageCost = messageCreditCost(lastUserContent);
      // ما خُصم فعلاً — لا ما كان يُفترض خصمه. الردّ لاحقاً يعتمد عليه: خصمٌ لم
      // يتم (قاعدة بيانات متعذّرة مثلاً) لا يُردّ، وإلا منحنا رصيداً بلا سبب.
      let chargedCredits = 0;
      let replyDelivered = false;
      try {
        if (ctx.effectiveUserId) {
          await credits.deductCredits(ctx.effectiveUserId, messageCost, "message",
            messageCost > 1 ? "رسالة طويلة للمحاسب الذكي" : "رسالة للمحاسب الذكي");
          chargedCredits = messageCost;
        }
      } catch (e) {
        if (e instanceof credits.InsufficientCreditsError) {
          const { TRPCError } = await import("@trpc/server");
          throw new TRPCError({ code: "FORBIDDEN", message: e.message });
        }
        // إن تعذّر الاتصال بقاعدة البيانات لا نمنع المحادثة
        console.warn("[agent.chat] credits deduction skipped:", e instanceof Error ? e.message : e);
      }
      // انقطاع المتصفح لا يرمي استثناءً على الخادم: الطلب يكتمل هنا بينما لا
      // يصل شيء للعميل. الاستماع لإغلاق الاستجابة قبل انتهاء الكتابة هو الطريق
      // الوحيد لملاحظته — وهو الحال الذي رأيناه فعلاً كرسالة "Load failed".
      const httpRes = ctx.res;
      if (httpRes && ctx.effectiveUserId) {
        httpRes.once("close", () => {
          if (replyDelivered || httpRes.writableFinished || chargedCredits <= 0) return;
          void credits.refundCredits(ctx.effectiveUserId!, chargedCredits,
            "ردّ نقاط: انقطع الاتصال قبل وصول الرد").catch(() => {});
        });
      }

      // ─── حفظ سجل المحادثة: إنشاء محادثة جديدة إن لم تُمرَّر، وحفظ رسالة المستخدم ───
      const dbHelpers = await import("../db");
      const lastUserMsg = [...input.messages].reverse().find(m => m.role === "user");
      let conversationId = input.conversationId;
      try {
        if (conversationId) {
          const conv = await dbHelpers.getConversationById(conversationId, ctx.user.id);
          if (!conv) conversationId = undefined;
        }
        if (!conversationId && lastUserMsg) {
          const title = lastUserMsg.content.slice(0, 80) || "محادثة جديدة";
          conversationId = await dbHelpers.createConversation(ctx.user.id, title);
        }
        if (conversationId && lastUserMsg) {
          await dbHelpers.addMessage(conversationId, "user", lastUserMsg.content);
        }
      } catch (e) {
        console.warn("[agent.chat] failed to persist conversation:", e instanceof Error ? e.message : e);
      }

      // ─── رؤى "المدير المالي" (تحليل استراتيجي وتوصيات تطوعية) حصرية للباقة المؤسسية (hasDirectSupport) ───
      let hasCfoSkill = false;
      let agentMode: AgentMode = "accounting";
      let hasAccounting = true;
      let hasExpert = false;
      try {
        if (ctx.effectiveUserId) {
          const sub = await dbHelpers.getSubscriptionByUserId(ctx.effectiveUserId);
          if (sub) {
            const plan = await dbHelpers.getPlanById(sub.planId);
            hasCfoSkill = plan?.hasDirectSupport ?? false;
            hasAccounting = plan?.mode !== "expert";
          }
          // الخبير خدمة موازية: من يحملها مع باقة محاسبية يأخذ الاثنين معاً
          const expertSub = await dbHelpers.getExpertSubscription(ctx.effectiveUserId);
          hasExpert = Boolean(expertSub);
          if (hasExpert || !hasAccounting) {
            // الوضع يُشتق من الاشتراكات. الفشل يُبقيه "accounting" — الأوسع
            // صلاحية — فلا يُحرم عميل من أدواته بسبب تعذّر قراءة باقته.
            const caps = resolveCapabilities({ hasAccounting, hasExpert });
            agentMode = caps.mode;
          }
        }
      } catch (e) {
        console.warn("[agent.chat] failed to resolve plan tier for persona:", e instanceof Error ? e.message : e);
      }

      const identityLine = identityLineFor(agentMode, hasCfoSkill);

      const SYSTEM = `أنت "المحاسب الذكي" من المعاصر AI — خبير مالي متعدد الأدوار ومساعد ذكاء اصطناعي متخصص في نظام Almoaser AI ERP (المبني على Frappe). ${identityLine}

## هويتك المهنية
لديك خبرة 15+ عاماً في المحاسبة المالية والإدارية والإدارة المالية، وأنت خبير معتمد في Almoaser AI ERP. تتقن:
- معايير المحاسبة الدولية (IFRS) والمحاسبة العربية
- دورة حياة المستندات (Draft → Submitted → Cancelled)
- جميع DocTypes الرئيسية: Sales Invoice, Purchase Invoice, Journal Entry, Payment Entry, Customer, Supplier, Item, Account, Stock Entry
- مبدأ القيد المزدوج (Double Entry): كل عملية لها مدين ودائن متساويان
- الميزانية العمومية، قائمة الدخل، التدفقات النقدية، ميزان المراجعة
- ضريبة القيمة المضافة (VAT) وأحكامها في دول الخليج
- إدارة المخزون بطرق FIFO وWeighted Average
- مراكز التكلفة (Cost Centers) وإدارة المشاريع

${buildExpertSkillsSection(hasCfoSkill)}

## قواعد العمل الأساسية
1. **نفّذ أولاً، اشرح ثانياً**: عند أي طلب يتعلق بفواتير/عملاء/أصناف/تقارير → استدعِ الأداة المناسبة فوراً ثم علّق على النتائج
2. **لا تعطِ إجابات نظرية**: إذا كان لديك أداة تنفذ الطلب، استخدمها مباشرة
3. **بعد تنفيذ الأداة**: لخّص النتائج بأسلوب محاسب محترف — أبرز الأرقام المهمة، نبّه على المتأخرات، اقترح الإجراء التالي
4. **منع التكرار — القاعدة الذهبية (الأهم على الإطلاق)**:
   - **ممنوع منعاً باتاً** إنشاء عميل أو صنف دون البحث عنه أولاً
   - قبل أي create_customer → ابحث بـ get_customers(search) — إن وُجد مطابق أو مشابه → **استخدم الموجود** ولا تنشئ نسخة مكررة
   - قبل أي create_item → ابحث بـ get_items(search) — إن وُجد مطابق أو مشابه → **استخدم الموجود**
   - **اختلاف الهمزات لا يعني سجلاً مختلفاً**: "اسلام" و"إسلام" و"أسلام" هم نفس العميل، وكذلك التاء المربوطة/الهاء (ة/ه) والألف المقصورة/الياء (ى/ي) — عاملها كنفس الاسم دائماً واستخدم السجل الموجود مهما اختلف الرسم الإملائي
   - إن وُجدت عدة نتائج مشابهة → **اعرضها على المستخدم واسأله أيها يقصد** قبل المتابعة
   - فقط إذا لم تجد أي تطابق → أنشئ الجديد ثم أكمل العملية الأصلية
5. **سير إنشاء الفاتورة الصحيح**:
   أ. get_customers(search: اسم العميل) → موجود؟ استخدمه : مشابه متعدد؟ اسأل : غير موجود؟ create_customer
   ب. get_items(search: اسم الصنف) → موجود؟ استخدمه : مشابه متعدد؟ اسأل : غير موجود؟ create_item بسعر الفاتورة
   ج. create_invoice بالأسماء الفعلية (name) المُعادة من البحث
   د. إذا أعادت الأداة needs_clarification مع candidates → اعرض الخيارات على المستخدم واسأله
   هـ. إذا أعادت duplicate_prevented → استخدم السجل الموجود من candidates وأكمل مباشرة دون سؤال
6. **اسأل المستخدم فقط** عن بيانات لا يمكنك استنتاجها (المبلغ، الكمية إذا لم تُذكر) أو عند وجود عدة مرشحين مشابهين
7. **استرجاع فاتورة**: "اعرض فاتورة SINV-XXX" → get_invoice_detail | "آخر الفواتير" → get_invoices
8. **اللغة / Language**: ردّ دائماً بنفس لغة رسالة المستخدم الأخيرة. If the user writes in English, respond entirely in professional English with correct accounting terminology (Invoice, Journal Entry, Accounts Receivable, Trial Balance...). إذا كتب المستخدم بالعربية فردّ بعربية فصيحة مهنية بمصطلحات محاسبية صحيحة. Keep replies concise and professional in both languages
9. **الاعتماد**: بعد إنشاء أي مستند (فاتورة/دفعة/قيد) اعرض اعتماده — إن وافق المستخدم أو طلبه معتمداً → استدعِ submit_invoice للفواتير أو submit_document لأي مستند آخر. المستند لا يؤثر على الحسابات إلا بعد الاعتماد
10. **الأرقام العربية**: حوّل الأرقام العربية (٦٥٠٠٠) إلى إنجليزية (65000) عند تمريرها للأدوات
11. **المستندات المستخرجة من الصور**: إذا احتوت المحادثة على "بيانات مستخرجة" من صورة (فاتورة/سند) وأكّد المستخدم التسجيل (نعم/سجّل/أكّد) → نفّذ فوراً حسب النوع: فاتورة مبيعات → سير إنشاء الفاتورة المعتاد (بحث عميل/أصناف ثم create_invoice) | فاتورة مشتريات → بحث مورد ثم create_purchase_invoice | سند قبض → create_payment_entry بنوع Receive | سند صرف → create_payment_entry بنوع Pay. إن صحّح المستخدم بيانات، استخدم البيانات المصحّحة
12. **التعديل**: لتعديل بيانات عميل/مورد/صنف → update_document مباشرة. لتعديل فاتورة/قيد/دفعة: إن كانت مسودة → update_document، وإن كانت معتمدة → أخبر المستخدم أنها تتطلب الإلغاء أولاً واعرض عليه: cancel_document ثم إنشاء مستند بديل بالبيانات الصحيحة
13. **الحذف والإلغاء**: delete_document حذف نهائي (يلغي المستند المعتمد تلقائياً قبل حذفه). **اطلب تأكيداً صريحاً من المستخدم قبل أي حذف أو إلغاء** واذكر رقم المستند وأثره (مثال: "إلغاء الفاتورة سيعكس أثرها من الحسابات — هل تؤكد؟"). لا تحذف أبداً دون تأكيد
14. **ضريبة القيمة المضافة (VAT)**: الضريبة تأتي **جاهزة من إعدادات نظام العميل** — create_invoice تطبّق قالب الضريبة الافتراضي (Sales Taxes and Charges Template) تلقائياً دون أي إعداد منك. لا تحسب الضريبة يدوياً ولا تضفها كصنف. الأسعار المُمررة rate هي قبل الضريبة، والنظام يحتسب النسبة ويظهرها في الفاتورة. إن طلب المستخدم فاتورة بدون ضريبة/معفاة → apply_vat: false. عند إخبار المستخدم بإجمالي الفاتورة اذكر: الإجمالي قبل الضريبة، الضريبة، والمجموع شامل الضريبة
14أ. **إعدادات الضريبة غير المضبوطة — إبلاغ ثم موافقة (مهم)**: إذا أعادت create_invoice نتيجة needs_clarification بسبب tax_settings_not_configured، أو أظهرت check_tax_setup نقصاً: **لا تُصدر الفاتورة بدون ضريبة بصمت أبداً**. بدلاً من ذلك: 1) أبلغ العميل بوضوح بما هو ناقص بالتحديد (من حقل missing) وأثره — "فاتورتك لن تكون فاتورة ضريبية نظامية بدون هذا" 2) اسأله عن نسبة الضريبة المطبقة في بلده إن لم تكن معروفة (15% السعودية، 14% مصر، 5% الإمارات) وعن الرقم الضريبي للشركة إن كان ناقصاً 3) **اطلب موافقته الصريحة**: "هل تسمح لي أضبط لك إعدادات الضريبة الآن؟" 4) بعد موافقته فقط، استدعِ setup_tax_settings مع confirmed: true 5) ثم أعد إنشاء الفاتورة. الأداة نفسها ترفض التنفيذ بدون confirmed: true — فلا تحاول تجاوز خطوة الموافقة. إن رفض العميل، أخبره أن الفاتورة ستُصدر بدون ضريبة وانتظر تأكيده على ذلك (apply_vat: false)
15. **الرقم الضريبي للعملاء (إلزامي لا اختياري)**: أي عميل من نوع شركة/مؤسسة **يجب** أن يكون له رقم ضريبي مسجّل قبل إصدار أي فاتورة مبيعات له. عند إنشاء عميل جديد اسأل عن الرقم الضريبي وامرّره في tax_id فوراً. إن حاولت إنشاء فاتورة مبيعات لعميل شركة بلا رقم ضريبي، ستُعيد create_invoice نتيجة needs_clarification بسبب missing_tax_id — عندها **توقف واسأل المستخدم عن الرقم الضريبي صراحةً**، سجّله بـ update_document (Customer، fields: {tax_id: "..."})، ثم أعد محاولة إنشاء الفاتورة. لا تنشئ الفاتورة بدون الرقم الضريبي ولا تتجاوز هذا الشرط إلا إذا أكّد المستخدم صراحةً أن العميل فرد (Individual) لا يملك سجلاً تجارياً
16. **ترتيب أسئلة إنشاء الفاتورة**: عندما يطلب العميل تسجيل فاتورة ولم يُعطِ كل التفاصيل دفعة واحدة، اسأل بالترتيب التالي (سؤالاً واحداً في كل مرة، لا تسأل كل الأسئلة دفعة واحدة): 1) اسم العميل — ثم تحقق من الرقم الضريبي المسجل له (راجع قاعدة 15) 2) الصنف أو الخدمة 3) الكمية 4) السعر. إذا ذكر المستخدم بعض التفاصيل مسبقاً في رسالته، لا تعد سؤالها، واسأل فقط عمّا تبقّى بنفس الترتيب
16أ. **التحقق من الرقم الضريبي**: النظام يتحقق تلقائياً من **صيغة** الرقم الضريبي حسب بلد الشركة (السعودية: 15 رقماً تبدأ وتنتهي بـ 3 — وفق متطلبات هيئة الزكاة والضريبة؛ مصر: 9 أرقام؛ الإمارات: 15 رقماً تبدأ بـ 100)، ويرفض الأرقام المستحيلة أو المفبركة بشكل واضح (كل الخانات متطابقة، أو أرقام متسلسلة). إن أعادت الأداة invalid_tax_id → أبلغ العميل بالمشكلة المحددة (حقل problem) واطلب الرقم الصحيح. **مهم جداً — لا تدّعِ أبداً أنك "تحققت من الرقم لدى هيئة الزكاة" أو أنه "مسجّل رسمياً"**: لا توجد واجهة برمجية رسمية من الهيئة للتحقق من التسجيل الفعلي، وخدمة التحقق على بوابتها يدوية فقط. أقصى ما نؤكده هو مطابقة الصيغة. إن سأل العميل عن التأكد النهائي، أرشده لبوابة الهيئة (zatca.gov.sa ← الخدمات الإلكترونية ← التحقق من المنشآت المسجلة في ضريبة القيمة المضافة)
17. **متطلبات الفوترة الإلكترونية حسب البلد**: قبل إنشاء أول فاتورة لعميل جديد، تحقق من بلد الشركة (get_settings على Company — الحقل country) إن لم تكن متأكداً منه بالفعل في هذه المحادثة. في السعودية: الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3 (قاعدة ZATCA) وهذا محقق تلقائياً عبر تنسيق النظام. في مصر أو أي دولة أخرى لها منظومة فوترة إلكترونية إلزامية (مثل منظومة الفاتورة الإلكترونية المصرية ETA)، لا تفترض صيغة الرقم الضريبي — اسأل المستخدم صراحةً: "هل عميلك مسجّل في منظومة الفوترة الإلكترونية في بلدكم؟ ما رقم تسجيله الضريبي؟" وسجّل ما يقوله دون التحقق من صيغة محددة. الهدف: لا تُصدر فاتورة لعميل شركة دون رقم ضريبي مسجل أياً كان بلد الشركة
## صلاحياتك الكاملة في النظام
أنت تملك صلاحيات كاملة للإدخال والتسجيل والاعتماد والتعديل والإلغاء والحذف في كل وحدات النظام (ضمن صلاحيات مستخدم ERPNext المتصل):
- **المبيعات**: فواتير مبيعات (إنشاء/عرض/اعتماد/تعديل/إلغاء/حذف)، عملاء (بحث/إنشاء/تعديل/حذف)
- **المشتريات**: فواتير مشتريات (create_purchase_invoice/get_purchase_invoices)، موردين (get_suppliers/create_supplier) — نفس قاعدة منع التكرار تنطبق على الموردين
- **التعديل والحذف الشامل**: update_document (تعديل أي حقل في فاتورة مسودة/عميل/مورد/صنف/قيد/دفعة)، cancel_document (إلغاء مستند معتمد)، delete_document (حذف نهائي مع إلغاء تلقائي للمعتمد) — أمثلة: "عدّل رقم جوال العميل محمود" → find_customer ثم update_document | "غيّر سعر صنف الاستشارة إلى 500" → find_item ثم update_document | "احذف الفاتورة SINV-0042" → تأكيد ثم delete_document | "ألغِ القيد JV-0010" → تأكيد ثم cancel_document
- **الدفعات**: create_payment_entry — تسجيل قبض من عميل (Receive) أو صرف لمورد (Pay)، مع إمكانية ربط الدفعة بفاتورة محددة لسدادها (reference_invoice). عند قول المستخدم "سجّل دفعة/سداد/قبض/تحصيل من عميل" → Receive، "دفعنا/سددنا لمورد" → Pay. طريقة الدفع (mode_of_payment) اختيارية وتُحل تلقائياً بمطابقة ذكية مع طرق الدفع المسجلة في النظام (نقد/شيك/حوالة مصرفية...) — إن أعادت الأداة needs_clarification مع available_modes فاعرضها على المستخدم ليختار. لا تتوقف عن تسجيل الدفعة بحجة الإعدادات — الحسابات الافتراضية تُجلب تلقائياً من إعدادات الشركة
- **قيود اليومية**: create_journal_entry — قيد مزدوج (مدين/دائن متساويان). قبل إنشاء القيد ابحث عن أسماء الحسابات الفعلية بـ get_accounts (الأسماء تتضمن اختصار الشركة مثل "Cash - X"). مثال: "سجل قيد: مدين الصندوق 3000 دائن المبيعات 3000" → get_accounts للصندوق والمبيعات ثم create_journal_entry
- **سير سداد فاتورة**: "سجل سداد فاتورة SINV-XXX" → get_invoice_detail لمعرفة العميل والمبلغ المتبقي → create_payment_entry مع reference_invoice → اعرض الاعتماد
- **إعدادات النظام لكافة الموديولات والمستندات**: get_settings لقراءة أي DocType إعدادات وupdate_settings لتعديله — يشمل ذلك بيانات الشركة، إعدادات البيع/الشراء/المخزون/الحسابات/النظام، قوالب الضرائب، **طرق الدفع (Mode of Payment) وربطها بحسابات الخزينة/الصندوق**، POS Profile، شروط الدفع، السنة المالية، مراكز التكلفة، المستودعات، وأي DocType آخر. أمثلة: "حدّث الرقم الضريبي للشركة" → update_settings(Company, {tax_id}) | "اربط طريقة الدفع نقدي بحساب الصندوق" → get_settings(Mode of Payment, name) لقراءة الوضع الحالي ثم update_settings(Mode of Payment, name, {accounts: [{company, default_account}]}) — ابحث عن اسم الحساب الفعلي بـ get_accounts أولاً | "غيّر العملة الافتراضية" → update_settings(Global Defaults). قبل أي تعديل إعدادات اقرأ القيم الحالية ولخّص التغيير للمستخدم

## قاعدة عدم الرفض الاستباقي (مهم جداً)
صلاحياتك في النظام هي **نفس صلاحيات مستخدم ERPNext المتصل بالكامل** — لا توجد لديك قيود إضافية. **يُمنع منعاً باتاً** أن ترفض طلب إعدادات أو تعديل بحجة أنك "تحتاج صلاحيات مسؤول النظام" أو "هذا يتجاوز صلاحياتك" قبل المحاولة الفعلية. القاعدة: **نفّذ دائماً عبر الأداة المناسبة**، وإن أعاد ERPNext خطأ صلاحيات (PermissionError) فعندها فقط انقل رسالة الخطأ للمستخدم واقترح الحل. أي طلب لتهيئة أو تعديل إعدادات أي موديول أو مستند (طرق الدفع، الحسابات الافتراضية، الضرائب، الشركة، الطباعة...) هو ضمن نطاق عملك المباشر.

**طلب طباعة/تنزيل/إرسال مستند:** إذا طلب العميل طباعة فاتورة أو تنزيل PDF أو "ابعتهالي" أو إرسال نسخة من أي مستند — استخدم أداة print_document فوراً، ولا تعتذر أبداً بعدم امتلاك صلاحية أو قدرة على الطباعة أو إرسال الملفات. الأداة تُصدر الملف فعلياً من نظام العميل **بنموذج الطباعة الافتراضي المضبوط عنده** وتسلّمه داخل المحادثة جاهزاً للفتح والتحميل — فلا تكتفِ بإعطاء رقم المستند أو بوصف كيفية طباعته يدوياً من النظام.
**بعد إنشاء أي فاتورة بنجاح — سير الاعتماد ثم الطباعة (مهم):** الفاتورة تُنشأ **مسودة**، والنموذج الرسمي في نظام العميل يحتوي غالباً رمز QR الضريبي الذي **لا يُولَّد إلا بعد الاعتماد** — فطباعة المسودة تخرج بشكل عام غير رسمي. لذلك بعد الإنشاء:
1. أبلغ العميل أن الفاتورة أُنشئت كمسودة مع رقمها وإجماليها.
2. **اطلب تأكيده الصريح على الاعتماد**، واشرح الأثر بوضوح: "الاعتماد يسجّل الفاتورة رسمياً في الحسابات ويصدرها بالشكل الضريبي المعتمد — هل أعتمدها؟" وأضف أزرار إجابة سريعة (نعم اعتمدها / لا اتركها مسودة).
3. **بعد موافقته فقط**: استدعِ submit_document ثم print_document فوراً لتصل النسخة الرسمية.
4. إن رفض أو أراد إبقاءها مسودة، لا تعتمدها. ولو طلب طباعتها كمسودة، اطبعها ونبّهه أنها ستخرج بالشكل العام لأنها غير معتمدة.
**لا تعتمد أي فاتورة تلقائياً دون تأكيد صريح من العميل** — الاعتماد يرحّل قيوداً محاسبية ولا يمكن التراجع عنه إلا بالإلغاء.

## خبرتك في Almoaser AI ERP
- **Sales Invoice**: فاتورة المبيعات — تُنشأ Draft ثم Submit لتسجّل في الحسابات. الحالات: Draft/Unpaid/Paid/Overdue/Cancelled
- **Purchase Invoice**: فاتورة المشتريات من الموردين
- **Journal Entry**: قيد محاسبي يدوي — يستخدم للتسويات والتحويلات
- **Payment Entry**: تسجيل دفعة مستلمة أو مدفوعة
- **Customer**: العميل — له رصيد مديونية (AR) في الحسابات
- **Supplier**: المورد — له رصيد دائنية (AP)
- **Item**: الصنف أو الخدمة — له سعر بيع وتكلفة
- **Account**: حساب في شجرة الحسابات — مصنّف: أصول/خصوم/حقوق/إيرادات/مصروفات
- **Cost Center**: مركز تكلفة لتوزيع المصروفات
- **Fiscal Year**: السنة المالية — تحدد فترات التقارير

## أسلوب الرد بعد تنفيذ الأداة
- **للفواتير**: أذكر الإجمالي، عدد غير المدفوعة، أقدم متأخرة، واقترح المتابعة
- **للتقارير**: قارن بالفترة السابقة إذا أمكن، أبرز نسبة التحصيل
- **للعملاء**: نبّه على العملاء ذوي الأرصدة المرتفعة
- **لإنشاء فاتورة**: أكّد رقمها وتاريخها وإجماليها، ذكّر بضرورة الاعتماد (Submit) لتسجيلها في الحسابات
- **لإنشاء عميل/صنف**: أكّد الإنشاء واذكر التفاصيل، ثم أكمل العملية الأصلية إن وُجدت

## أزرار الإجابات السريعة (Quick Replies) — إلزامي
كلما طرحت على المستخدم سؤالاً (تأكيد، استيضاح، اختيار بين مرشحين، اعتماد مستند، حذف/إلغاء...) يجب أن تُنهي ردّك بسطر أخير منفصل بهذه الصيغة بالضبط:
[QUICK_REPLIES: خيار 1 | خيار 2 | خيار 3]
قواعده:
- الخيارات نصوص قصيرة (كلمة إلى 4 كلمات) يستطيع المستخدم إرسالها كما هي دون كتابة، بنفس لغة المحادثة
- من 2 إلى 4 خيارات، ورتّب الإجابة الأرجح أولاً
- أمثلة: سؤال اعتماد فاتورة → [QUICK_REPLIES: نعم، اعتمدها | لا، اتركها مسودة]
  سؤال تأكيد حذف → [QUICK_REPLIES: نعم، احذفها نهائياً | لا، تراجع]
  اختيار بين عملاء متشابهين → [QUICK_REPLIES: شركة النور للتجارة | شركة النور للمقاولات | عميل جديد]
  سؤال عن بيانات ناقصة بخيارات محتملة → اقترح قيماً منطقية كخيارات
- لا تضع السطر إذا كان ردّك خبرياً لا يتطلب إجابة من المستخدم
- **بعد عرض قائمة بما تستطيع فعله، أو بعد إتمام عملية، ضع السطر بأرجح ثلاث خطوات تالية.** القائمة بلا أزرار تُقرأ ثم تُنسى، والزر يُضغط. مثال بعد عرض القدرات: [QUICK_REPLIES: اعرض آخر ١٠ فواتير | كم الفواتير غير المدفوعة؟ | فحص إعدادات الضريبة]
- **لا تتحدث عن الأزرار ولا تعد بها.** لا تقل "تفضل الأزرار" ولا "اضغط على الخيارات" — أصدِر السطر وحده والواجهة تتولّى عرضه. الكلام عن أزرار لم تُصدرها يجعل المستخدم يبحث عمّا لا وجود له.
- لا تذكر هذا السطر أو صيغته في نص الرد أبداً — هو للواجهة فقط

## تاريخ اليوم
اليوم هو ${new Date().toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. استخدمه عند حساب التواريخ والفترات.

${modeRulesFor(agentMode)}`;

      const llmMessages: Array<{
        role: "system" | "user" | "assistant" | "tool";
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
      }> = [
        { role: "system", content: SYSTEM },
        // نرسل آخر نافذة من التاريخ لا التاريخ كله: كل استدعاء يعيد إرسال
        // السياق بالكامل، فمحادثة طويلة تضاعف تكلفة كل رسالة تالية فيها.
        // القصّ يقع عند رسالة user حتى لا تُيتَّم رسالة tool فيُرفض الطلب.
        ...trimHistory(input.messages).map(m => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
      ];

      // لا نعرض على النموذج أدوات سيُرفض تنفيذها لهذا المستخدم أصلاً — لا بصلاحيات
      // المنصة ولا بصلاحياته في نظامه هو. تُحسب داخل سياق ERP أدناه.
      // الترتيب مقصود: وضع الباقة أولاً (حدّ المنتج)، ثم صلاحيات المنصة، ثم
      // صلاحيات نظام العميل. كل طبقة تضيّق ولا توسّع.
      let availableTools = toolsForUser(toolsForSubscriptions(TOOLS, { hasAccounting, hasExpert }), ctx.user);

      const toolResults: Array<{ tool_call_id: string; tool_name: string; display: string }> = [];

      // تشغيل كامل حلقة الوكيل ضمن سياق اتصال ERPNext الخاص بالمستخدم الحالي
      try {
        return await runWithErpConfig(ctx.user.id, async () => {
      // ─── تضييق إضافي بصلاحيات المستخدم في نظامه هو ───────────────────────
      // مصدر الحقيقة لما يستطيعه العميل هو ERP الخاص به، لا جدولنا. الفشل هنا
      // يعود للتضييق السابق ولا يحجب شيئاً: النظام نفسه هو الحاجز عند التنفيذ.
      availableTools = await narrowToolsByErpPermissions(availableTools);
      for (let iter = 0; iter < 8; iter++) {
        let response;
        try {
          response = await invokeAgentLLM({
            messages: llmMessages,
            tools: availableTools,
            tool_choice: "auto",
            maxTokens: 2000,
          });
          void logLlmUsage({
            userId: ctx.effectiveUserId ?? ctx.user.id,
            provider: response._provider ?? "builtin",
            usage: response.usage,
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "LLM invocation failed";
          console.error("[agent.chat] invokeAgentLLM error:", errMsg);
          const quotaHit = /usage exhausted|insufficient_quota|412|429/i.test(errMsg);
          // السبب التقني للمدير فقط — العميل يرى رسالة عامة دون أي تفاصيل
          alertAdminsProviderFailure(quotaHit ? `نفاد رصيد مزود النموذج: ${errMsg}` : errMsg);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "عذراً، المساعد الذكي مشغول حالياً — يرجى المحاولة بعد قليل 🙏",
          });
        }

        const msg = response?.choices?.[0]?.message;
        if (!msg) {
          console.error("[agent.chat] empty LLM response:", JSON.stringify(response)?.slice(0, 500));
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "أعاد النموذج الذكي استجابة فارغة — يرجى إعادة صياغة الطلب أو المحاولة مرة أخرى" });
        }

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          const rawReply = typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content.map((c: { type?: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("")
              : "";
          const { text: replyText, quickReplies } = extractQuickReplies(rawReply);
          if (conversationId && replyText) {
            try {
              await dbHelpers.addMessage(conversationId, "assistant", replyText,
                toolResults.length || quickReplies.length
                  ? JSON.stringify({ toolResults, quickReplies })
                  : undefined);
            } catch { /* non-blocking */ }
          }
          return { reply: replyText, toolResults, quickReplies, conversationId };
        }

        llmMessages.push({
          role: "assistant" as const,
          content: "",
          tool_calls: msg.tool_calls.map((tc: { id?: string; index?: number; function: { name: string; arguments: string } }) => ({
            id: tc.id ?? `call_${tc.index ?? Math.random().toString(36).slice(2)}`,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        for (const tc of msg.tool_calls as Array<{ id?: string; index?: number; function: { name: string; arguments: string } }>) {
          const tcId = tc.id ?? `call_${tc.index ?? Math.random().toString(36).slice(2)}`;
          let toolResult: string;
          let displayData = "";
          try {
            requireToolPermission(ctx.user, tc.function.name);
            const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
            const activeConfig = currentErpConfig();
            // print_document لا يلمس ERPNext/Odoo مباشرة — فقط يعرض للعميل زر تحميل PDF
            // (نفس نموذج الطباعة الفعلي في نظامه)، بغض النظر عن المزوّد
            const { result, display } = tc.function.name === "print_document"
              ? (() => {
                  const doc = { doctype: args.doctype as string, name: args.document_name as string };
                  return { result: doc, display: `__DOCUMENT_PRINT__${JSON.stringify(doc)}` };
                })()
              : activeConfig.provider === "odoo" && activeConfig.database
                ? await executeOdooTool(tc.function.name, args, activeConfig as ErpConfig & { database: string })
                : await executeTool(tc.function.name, args, { userId: ctx.effectiveUserId ?? ctx.user.id, conversationId });
            toolResult = JSON.stringify(result);
            displayData = display;
            // ─── خصم 5 نقاط لكل مستند ERP يُنشأ بنجاح (فاتورة/دفعة/قيد) — من رصيد المنظمة المشترك ───
            try {
              const DOC_TOOLS = new Set(["create_invoice", "create_purchase_invoice", "create_payment_entry", "create_journal_entry"]);
              const resObj = result as { error?: unknown; needs_clarification?: unknown; duplicate_prevented?: unknown } | null;
              const succeeded = resObj && typeof resObj === "object" && !resObj.error && !resObj.needs_clarification && !resObj.duplicate_prevented;
              if (DOC_TOOLS.has(tc.function.name) && succeeded && ctx.effectiveUserId) {
                await credits.deductCredits(ctx.effectiveUserId, credits.DOCUMENT_COST, "document", `إنشاء مستند (${tc.function.name})`).catch(() => {});
              }
            } catch { /* خصم النقاط لا يوقف التنفيذ */ }
            // إشعار داخل الموقع + push عند إنشاء/اعتماد فاتورة عبر الوكيل
            try {
              if (displayData.startsWith("__INVOICE_CREATED__")) {
                const inv = JSON.parse(displayData.slice("__INVOICE_CREATED__".length)) as { name?: string; customer?: string; grand_total?: number };
                notifyUser({
                  userId: ctx.user.id,
                  type: "invoice_created",
                  title: "فاتورة جديدة",
                  body: `أنشأ الوكيل الفاتورة ${inv.name ?? ""} للعميل ${inv.customer ?? ""} بقيمة ${inv.grand_total ?? ""}.`,
                  link: "/invoices",
                }).catch(() => {});
              } else if (displayData.startsWith("__INVOICE_SUBMITTED__")) {
                const inv = JSON.parse(displayData.slice("__INVOICE_SUBMITTED__".length)) as { name?: string; grand_total?: number };
                notifyUser({
                  userId: ctx.user.id,
                  type: "invoice_submitted",
                  title: "تم اعتماد فاتورة",
                  body: `اعتُمدت الفاتورة ${inv.name ?? ""} بقيمة ${inv.grand_total ?? ""} في النظام.`,
                  link: "/invoices",
                }).catch(() => {});
              }
            } catch { /* الإشعار لا يوقف التنفيذ */ }
          } catch (e) {
            const rawErr = e instanceof Error ? e.message : "Tool execution failed";
            console.error(`[agent.chat] tool ${tc.function.name} failed:`, rawErr);
            toolResult = JSON.stringify({ error: translateErpError(rawErr) });
          }
          toolResults.push({ tool_call_id: tcId, tool_name: tc.function.name, display: displayData });
          llmMessages.push({ role: "tool", content: toolResult, tool_call_id: tcId });
        }
      }

      if (conversationId) {
        try {
          await dbHelpers.addMessage(conversationId, "assistant", "تم تنفيذ الطلب.",
            toolResults.length ? JSON.stringify({ toolResults, quickReplies: [] }) : undefined);
        } catch { /* non-blocking */ }
      }
      return { reply: "تم تنفيذ الطلب.", toolResults, quickReplies: [] as string[], conversationId };
        }).then(r => { replyDelivered = true; return r; });
      } catch (e) {
        // فشل بعد الخصم = خدمة لم تُقدَّم. الردّ لا يبتلع الخطأ، يعيده كما هو.
        if (chargedCredits > 0 && ctx.effectiveUserId) {
          await credits.refundCredits(ctx.effectiveUserId, chargedCredits,
            "ردّ نقاط: تعذّر إنتاج الرد").catch(() => {});
        }
        throw e;
      }
    }),

  // ─── سجل المحادثات ────────────────────────────────────────────────────────
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    const dbHelpers = await import("../db");
    return dbHelpers.getConversationsByUserId(ctx.user.id);
  }),

  createConversation: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255).default("محادثة جديدة") }).optional())
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      const id = await dbHelpers.createConversation(ctx.user.id, input?.title ?? "محادثة جديدة");
      return { conversationId: id };
    }),

  getConversationMessages: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      const conv = await dbHelpers.getConversationById(input.conversationId, ctx.user.id);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "المحادثة غير موجودة" });
      const messages = await dbHelpers.getMessagesByConversationId(input.conversationId);
      return { conversation: conv, messages };
    }),

  renameConversation: protectedProcedure
    .input(z.object({ conversationId: z.number(), title: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      await dbHelpers.updateConversationTitle(input.conversationId, ctx.user.id, input.title);
      return { success: true };
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const dbHelpers = await import("../db");
      await dbHelpers.deleteConversation(input.conversationId, ctx.user.id);
      return { success: true };
    }),

  // يولّد PDF أي مستند (فاتورة مبيعات/مشتريات، دفعة، قيد يومية) من نموذج الطباعة
  // الافتراضي الفعلي المُعدّ في نظام العميل (ERPNext أو Odoo) — وليس نموذجاً ثابتاً
  // في تطبيقنا، حتى يطابق دائماً ما يراه العميل لو طبع من نظامه مباشرة
  // حالة المستند — لتعرف الواجهة إن كان مسودة (فتعرض زر الاعتماد بدل الطباعة)
  getDocumentStatus: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .query(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      const config = currentErpConfig();
      if (config.provider === "odoo" && config.database) {
        // Odoo: نستنتج الحالة من state عبر أدوات Odoo
        return { docstatus: null as number | null, provider: "odoo" as const };
      }
      const doc = await erpGET(`/api/resource/${encodeURIComponent(input.doctype)}/${encodeURIComponent(input.name)}`) as { data?: { docstatus?: number; grand_total?: number; status?: string } };
      return {
        docstatus: doc?.data?.docstatus ?? null,
        grandTotal: doc?.data?.grand_total ?? null,
        status: doc?.data?.status ?? null,
        provider: "erpnext" as const,
      };
    })),

  // اعتماد مستند من الواجهة — بعد تأكيد المستخدم صراحةً بالضغط على الزر
  submitDocument: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .mutation(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      requireToolPermission(ctx.user, "submit_document");
      try {
        const result = await submitDoc(input.doctype, input.name);
        return { success: true as const, name: result?.name ?? input.name, status: result?.status ?? null };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: translateErpError(e instanceof Error ? e.message : String(e)) });
      }
    })),

  getDocumentPdf: protectedProcedure
    .input(z.object({
      doctype: z.enum(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]).default("Sales Invoice"),
      name: z.string(),
    }))
    .mutation(async ({ input, ctx }) => runWithErpConfig(ctx.user.id, async () => {
      const config = currentErpConfig();
      if (config.provider === "odoo" && config.database) {
        const { getOdooDocumentPdf } = await import("../odooTools");
        const result = await getOdooDocumentPdf(config as ErpConfig & { database: string }, input.doctype, input.name);
        if ("error" in result) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
        return { ...result, fallbackReason: undefined as string | undefined };
      }
      const erpUrl = erpBaseUrl();
      const sid = await getSession();
      const buildUrl = (format?: string) =>
        `${erpUrl}/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(input.doctype)}&name=${encodeURIComponent(input.name)}&no_letterhead=0`
        + (format ? `&format=${encodeURIComponent(format)}` : "");

      // نقرأ اسم نموذج الطباعة الافتراضي المضبوط فعلياً في إعدادات الـ DocType عند العميل
      // ونطبع به صراحةً (بدل ترك ERPNext يستنتجه ضمنياً)، ثم نتدرّج في بدائل مناسبة عند فشله
      const candidates = await resolvePrintFormatCandidates(input.doctype);
      let res: Response | null = null;
      let usedFormat: string | undefined;
      const failures: string[] = [];
      for (const candidate of candidates) {
        const attempt = await fetch(buildUrl(candidate), { headers: { Cookie: `sid=${sid}` } });
        if (attempt.ok) { res = attempt; usedFormat = candidate ?? "(افتراضي النظام)"; break; }
        const body = await attempt.text().catch(() => "");
        failures.push(`${candidate ?? "(default)"} → ${attempt.status} ${body.slice(0, 200)}`);
      }
      if (!res) {
        console.error(`[getDocumentPdf] all print formats failed for ${input.doctype} ${input.name}:\n${failures.join("\n")}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "تعذّر توليد PDF المستند — فشل نموذج الطباعة المضبوط وكل البدائل. راجع نماذج الطباعة في نظامك، وتحقق أن wkhtmltopdf المثبّت على خادم ERPNext هو إصدار patched-qt المطلوب",
        });
      }
      // إن اضطررنا لنموذج بديل، نوضّح السبب للمستخدم بدل تسليم شكل عام دون تفسير.
      // السبب الأشيع: النموذج الرسمي يحتوي رمز QR الضريبي الذي لا يُولَّد إلا بعد
      // اعتماد المستند، فتفشل الطباعة على المسودة بخطأ "روابط صورة مكسورة".
      let fallbackReason: string | undefined;
      const requestedFormat = candidates[0];
      if (failures.length > 0) {
        console.warn(`[getDocumentPdf] ${input.doctype} ${input.name}: printed with "${usedFormat}" after ${failures.length} failed candidate(s):\n${failures.join("\n")}`);
        const firstFailure = failures[0] ?? "";
        const brokenImage = /broken image|صورة مكسورة/i.test(firstFailure);
        let isDraft = false;
        try {
          const doc = await erpGET(`/api/resource/${encodeURIComponent(input.doctype)}/${encodeURIComponent(input.name)}`) as { data?: { docstatus?: number } };
          isDraft = doc?.data?.docstatus === 0;
        } catch { /* غير حرج */ }
        fallbackReason = brokenImage && isDraft
          ? `النموذج الرسمي "${requestedFormat}" يتطلب اعتماد المستند أولاً (رمز QR الضريبي لا يُولَّد قبل الاعتماد)، فطُبع مؤقتاً بـ"${usedFormat}"`
          : `تعذّر استخدام النموذج الافتراضي "${requestedFormat}"، فطُبع بـ"${usedFormat}"`;
      }
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { pdfBase64: base64, filename: `${input.name}.pdf`, printFormat: usedFormat, fallbackReason };
    })),

  // ─── تحويل الصوت إلى نص (إدخال صوتي للوكيل) ─────────────────────────────
  transcribeVoice: protectedProcedure
    .input(z.object({
      audioBase64: z.string(),
      mimeType: z.string().default("audio/webm"),
    }))
    .mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.audioBase64, "base64");
      if (buffer.length > 15 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "التسجيل الصوتي كبير جداً — الحد الأقصى 15 ميجابايت" });
      }
      const ext = input.mimeType.includes("mp4") ? "m4a"
        : input.mimeType.includes("ogg") ? "ogg"
        : input.mimeType.includes("wav") ? "wav"
        : input.mimeType.includes("mpeg") ? "mp3"
        : "webm";
      const fileKey = `voice/${ctx.user.id}-${Date.now()}.${ext}`;
      // storagePut يعيد key نهائياً بلاحقة عشوائية — استخدمه هو لطلب الرابط الموقّع
      const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
      const signedUrl = await storageGetSignedUrl(key);
      try {
        const result = await transcribeAudio({
          audioUrl: signedUrl,
          prompt: "محادثة محاسبية بالعربية مع نظام ERP: فواتير، عملاء، أصناف، دفعات، قيود يومية، مبالغ بالريال",
        });
        if ("error" in result) {
          throw new Error(String(result.error));
        }
        const text = (result.text ?? "").trim();
        if (!text) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "لم أتمكن من سماع كلام واضح في التسجيل — حاول مرة أخرى" });
        }
        return { text, audioUrl: url };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        console.error("[agent.transcribeVoice] failed:", e instanceof Error ? e.message : e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحويل التسجيل الصوتي إلى نص — حاول مرة أخرى" });
      }
    }),

  // ─── استخراج بيانات فاتورة/سند قبض من صورة (OCR بالذكاء الاصطناعي) ──────
  extractDocument: protectedProcedure
    .input(z.object({
      imageBase64: z.string(),
      mimeType: z.string().default("image/jpeg"),
    }))
    .mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.imageBase64, "base64");
      if (buffer.length > 10 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "الصورة كبيرة جداً — الحد الأقصى 10 ميجابايت" });
      }
      const ext = input.mimeType.includes("png") ? "png" : input.mimeType.includes("webp") ? "webp" : "jpg";
      const fileKey = `docs/${ctx.user.id}-${Date.now()}.${ext}`;
      const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
      const signedUrl = await storageGetSignedUrl(key);

      let response;
      try {
        // invokeAgentLLM لا invokeLLM: الأخير يقصد OpenAI/المدمج مباشرة ويرمي
        // "OPENAI_API_KEY is not configured" — بقيّة المنصة انتقلت إلى
        // OpenRouter وبقي هذا المسار وحده على الإعداد القديم، فتعطّلت قراءة
        // الصور وحدها بينما الدردشة تعمل. الموديل الأول في القائمة يقبل الصور.
        response = await invokeAgentLLM({
          messages: [
            {
              role: "system",
              content: "أنت خبير OCR محاسبي. استخرج بيانات المستند المالي من الصورة بدقة. حوّل الأرقام العربية (١٢٣) إلى إنجليزية (123). التواريخ بصيغة YYYY-MM-DD. إذا لم يكن المستند فاتورة أو سنداً مالياً، اجعل doc_type = unknown.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: "استخرج بيانات هذا المستند المالي (فاتورة مبيعات، فاتورة مشتريات، أو سند قبض/صرف):" },
                { type: "image_url", image_url: { url: signedUrl, detail: "high" } },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "financial_document",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  doc_type: { type: "string", enum: ["sales_invoice", "purchase_invoice", "receipt_voucher", "payment_voucher", "unknown"], description: "نوع المستند" },
                  party_name: { type: "string", description: "اسم العميل أو المورد أو الدافع" },
                  date: { type: "string", description: "تاريخ المستند YYYY-MM-DD أو فارغ" },
                  invoice_number: { type: "string", description: "رقم الفاتورة/السند في الصورة إن وجد" },
                  items: {
                    type: "array",
                    description: "الأصناف/البنود",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        qty: { type: "number" },
                        rate: { type: "number" },
                        amount: { type: "number" },
                      },
                      required: ["description", "qty", "rate", "amount"],
                      additionalProperties: false,
                    },
                  },
                  total_amount: { type: "number", description: "الإجمالي النهائي" },
                  vat_amount: { type: "number", description: "قيمة الضريبة إن وجدت وإلا 0" },
                  currency: { type: "string", description: "العملة إن ظهرت وإلا فارغ" },
                  notes: { type: "string", description: "أي ملاحظات مهمة أخرى في المستند" },
                },
                required: ["doc_type", "party_name", "date", "invoice_number", "items", "total_amount", "vat_amount", "currency", "notes"],
                additionalProperties: false,
              },
            },
          },
        });
      } catch (e) {
        console.error("[agent.extractDocument] LLM failed:", e instanceof Error ? e.message : e);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر قراءة الصورة — تأكد من وضوحها وحاول مرة أخرى" });
      }

      const raw = response?.choices?.[0]?.message?.content;
      const jsonText = typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw.map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("")
          : "";
      let extracted: {
        doc_type: string; party_name: string; date: string; invoice_number: string;
        items: Array<{ description: string; qty: number; rate: number; amount: number }>;
        total_amount: number; vat_amount: number; currency: string; notes: string;
      };
      try {
        extracted = JSON.parse(jsonText);
      } catch {
        console.error("[agent.extractDocument] JSON parse failed:", jsonText?.slice(0, 300));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّر تحليل بيانات المستند — حاول بصورة أوضح" });
      }

      if (extracted.doc_type === "unknown") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لم أتعرف على مستند مالي في هذه الصورة — تأكد أنها صورة فاتورة أو سند قبض/صرف واضحة" });
      }

      return { extracted, imageUrl: url };
    }),
});
// ─── إشعار المدير بأعطال مزود النموذج (مع منع التكرار خلال ساعة) ─────────────
let lastProviderAlertAt = 0;
function alertAdminsProviderFailure(technicalReason: string) {
  const now = Date.now();
  if (now - lastProviderAlertAt < 60 * 60 * 1000) return; // إشعار واحد كحد أقصى كل ساعة
  lastProviderAlertAt = now;
  notifyAdmins({
    type: "provider_error",
    title: "عطل في مزود النموذج الذكي — العملاء يتلقون رسالة انشغال",
    body: `السبب التقني: ${technicalReason.slice(0, 300)}\n\nإن كان السبب نفاد الرصيد: اشحن رصيد OpenAI من platform.openai.com/settings/organization/billing`,
    link: "/admin",
  }).catch(() => {});
}
