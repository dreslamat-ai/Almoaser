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

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
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

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
  installGracefulShutdown(server);
  startScheduledJobs();
}

startServer().catch(console.error);
