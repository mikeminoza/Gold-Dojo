// Gold Dojo's service worker: only shows push notifications (no caching).
// The bot sends JSON: { title, body, url, tag }.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Gold Dojo", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "/icon-dark.svg",
      data: { url: data.url || "/" },
    }),
  );
});

// Tapping a notification: bring an open Gold Dojo tab forward, else open the link
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  // Only open pages on this site
  const target = url.origin === self.location.origin ? url.href : self.location.origin + "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const open = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (open) {
        return open.focus().then((t) => (t && t.url !== target && "navigate" in t ? t.navigate(target) : t));
      }
      return self.clients.openWindow(target);
    }),
  );
});
