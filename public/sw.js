self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Next Horizon", {
      body: data.body ?? "Neue Benachrichtigung",
      icon: "/logo-nh.png",
      badge: "/icon-192.png",
      tag: data.tag ?? "nh-select",
      renotify: true,
      data: { url: data.url ?? "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        const target = event.notification.data?.url ?? "/dashboard";
        for (const win of wins) {
          if ("focus" in win) {
            win.navigate(target);
            return win.focus();
          }
        }
        return clients.openWindow(target);
      })
  );
});
