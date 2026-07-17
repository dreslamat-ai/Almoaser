/* معالج إشعارات Web Push — يُحقن في service worker عبر importScripts */
self.addEventListener("push", (event) => {
  let data = { title: "المعاصر", body: "", link: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    /* payload ليس JSON */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-96x96.png",
      dir: "rtl",
      lang: "ar",
      data: { link: data.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) client.navigate(link);
          return;
        }
      }
      return clients.openWindow(link);
    })
  );
});
