import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startScheduledJobs } from "../scheduler";
import { registerMyFatoorahWebhook } from "../myfatoorahWebhook";
import { registerTelegramWebhook } from "../telegramWebhook";
import { registerLlmUsageIngest } from "../llmUsageIngest";

/**
 * إنهاء لطيف: نتوقف عن قبول الجديد ونمهل الجاري أن يكتمل.
 *
 * العملية واحدة بوضع fork، فإعادة التشغيل تقتلها وتقتل معها كل طلب في الطريق.
 * رسالة الوكيل تستغرق ثوانٍ (قياس الإنتاج: ١.٢ إلى ٢١ ثانية)، فالنشر أثناء
 * محادثة كان يقطع الاتصال ويظهر للعميل خطأ شبكة — وقد رأيناه فعلاً. والأسوأ
 * أن النقاط تُخصم في أول المعالجة: الطلب المقطوع يُحاسَب عليه بلا رد.
 *
 * pm2 restart يرسل SIGINT وpm2 stop يرسل SIGTERM — تُلتقط الإشارتان.
 *
 * **ملاحظة تشغيلية:** المهلة الفعلية يحدّدها kill_timeout في pm2 (افتراضه
 * ١٦٠٠ مللي ثانية) لا هذا الرقم. ما لم يُرفع هناك، تُقتل العملية قبل أن يكتمل
 * الطلب الطويل مهما انتظرنا هنا. انظر ecosystem.config.cjs.
 */
function installGracefulShutdown(server: import("http").Server): void {
  const GRACE_MS = 25_000;
  let closing = false;

  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[shutdown] ${signal} — توقف قبول الطلبات، في انتظار الجاري`);

    // مهلة قصوى: طلب معلّق إلى الأبد يجب ألّا يمنع النشر
    const forced = setTimeout(() => {
      console.warn("[shutdown] انتهت المهلة — إنهاء قسري");
      process.exit(0);
    }, GRACE_MS);
    forced.unref();

    server.close(() => {
      console.log("[shutdown] اكتملت الطلبات الجارية");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * العنوان الذي نسمع عليه — **loopback افتراضاً**.
 *
 * كان `server.listen(port)` بلا عنوان، ومعناه في node الربطُ على `0.0.0.0`:
 * أي أن التطبيق كان **مفتوحاً للإنترنت مباشرةً على `http://<IP>:3000`** —
 * `/login` يرد ٢٠٠ بلا شهادة ولا تشفير، فكلمةُ سرّ من يدخل من هناك تمشي نصّاً
 * صريحاً. قِيس فعلاً في ٧ أغسطس ٢٠٢٦ من العنوان العامّ.
 *
 * ولا حاجة لذلك أصلاً: nginx وحده من يكلّم التطبيق، وتمبليت `nodeapp3000`
 * يكتب `proxy_pass http://127.0.0.1:3000` في نسختَي HTTP وHTTPS كلتيهما.
 * فالربطُ على loopback **لا ينقص شيئاً من `erpsys.cloud`** ويُغلق البابَ الخلفيّ.
 *
 * **والافتراضُ هنا في الشيفرة لا في `ecosystem.config.cjs`** — pm2 لا يعيد
 * قراءة ذلك الملفّ عند `restart` (تعليقه نفسه يقول ذلك)، فمتغيّرٌ يوضع هناك
 * إصلاحٌ **يبدو مطبَّقاً وليس كذلك**. و`HOST` يبقى بابَ التجاوز لمن يحتاجه.
 */
const HOST = process.env.HOST ?? "127.0.0.1";

/**
 * **والمنفذ ثابتٌ أو نتوقّف — لا يُبحث عن بديل.**
 *
 * كان هنا `findAvailablePort` يجرّب ٢٠ منفذاً بعد المطلوب. وnginx يكتب
 * `127.0.0.1:3000` نصّاً، فأيُّ بديلٍ يعني أن **pm2 يقول `online` والسجلّ يقول
 * «استُعمل 3001» وnginx يردّ 502 للعملاء** — عطلٌ تامّ بلا سطرِ خطأٍ واحد،
 * وكلُّ مؤشّرٍ أخضر. سقوطٌ صريحٌ عند البدء خيرٌ من عملٍ يبدو ناجحاً ولا يُخدَم.
 *
 * وكان الفحصُ سيصير **كاذباً** بعد تثبيت العنوان على أي حال: يجرّب الربط على
 * `0.0.0.0` بينما الخادمُ سيربط على loopback — فيقيس غيرَ ما سيقع.
 */
function assertPortFree(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `المنفذ ${host}:${port} مشغول (${err.code}). ` +
            `nginx يوصّل إلى 127.0.0.1:3000 نصّاً، فلا بديلَ يُخدَم — ` +
            `أوقف ما يشغله بدل تشغيلنا على منفذٍ لا يصل إليه أحد.`
        )
      );
    });
    probe.listen(port, host, () => probe.close(() => resolve()));
  });
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // Webhook إشعار الدفع من MyFatoorah — يُنهي تفعيل الاشتراك/الشحن تلقائياً حتى
  // لو لم يعد العميل لصفحة الكولباك بعد الدفع
  registerMyFatoorahWebhook(app);
  registerTelegramWebhook(app);
  registerLlmUsageIngest(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000");
  await assertPortFree(port, HOST);

  server.listen(port, HOST, () => {
    console.log(`Server running on http://${HOST}:${port}/`);
  });
  installGracefulShutdown(server);
  startScheduledJobs();
}

startServer().catch(console.error);
