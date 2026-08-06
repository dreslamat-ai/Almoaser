import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  //**رقمٌ لا `string | number`** — تحميلُ `listen(port, host, cb)` الزائد يشترط
  //رقماً، وسابقُه `listen(port, cb)` كان يقبل الاتّنين فمرّ النوعُ المختلط.
  const port = parseInt(process.env.PORT || "3000", 10);

  /**
   * **loopback افتراضاً — كما في `_core/index.ts`.**
   *
   * هذا الملفُّ ليس مدخلَ البناء اليوم (‏`build` يحزم `server/_core/index.ts`‏)،
   * لكنّه يحمل **نفسَ الخطأ الذي فتح التطبيقَ للإنترنت على `:3000` بلا تشفير**:
   * `listen(port)` بلا عنوانٍ يربط على `0.0.0.0`. ومدخلُ البناء يتغيّر بسطرٍ
   * في `package.json`، فتُركُه مصلَحاً في أحدهما دون الآخر يعيد الثغرةَ يومَ
   * يتبدّل المدخل — ولا أحدَ يربط بين الأمرين حينها.
   */
  const host = process.env.HOST ?? "127.0.0.1";

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(console.error);
