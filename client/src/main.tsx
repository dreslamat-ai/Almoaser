import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App";
import { startLogin } from "./const";
import "./index.css";

// نُخطر المستخدم بوجود تحديث جديد بدل الاعتماد على skipWaiting فقط —
// بدونها ممكن يفضل يشوف نسخة قديمة من الواجهة لحد ما يعمل تحديث يدوي
const updateSW = registerSW({
  // تبويبةٌ تبقى مفتوحة يوماً كاملاً لن تسأل عن نسخةٍ جديدة إلا عند إعادة
  // التحميل. فتُسأل كل ساعة، وإلّا لم يكن للزرّ ما يُظهره.
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
  },
  onNeedRefresh() {
    toast.info("تحديث جديد متاح", {
      description: "أعد تحميل الصفحة لرؤية آخر التحديثات",
      duration: Infinity,
      action: { label: "تحديث الآن", onClick: () => updateSW(true) },
    });
  },
});

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  startLogin();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
