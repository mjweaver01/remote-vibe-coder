// remote-vibe-coder service worker — handles Web Push delivery.
// Activated only after the user opts in via the Notifications toggle.
// SW_VERSION bump forces a byte change so browsers pick up updates on reload.
const SW_VERSION = "2026-05-12.d";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal fetch handler — required for Chrome to treat the app as installable.
// We don't cache anything: the app is LAN-first and needs a live server + WS.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = { title: "Claude is waiting", body: "Tap to open the session." };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    (async () => {
      console.log("[rvc-sw]", SW_VERSION, "push", payload.sessionId, payload.tag);

      // Only surface notifications if this browser is currently "tracking"
      // the app — i.e. has at least one tab open on this origin. If every
      // tab is closed, suppress (the user isn't watching the active sessions
      // list, so a desktop banner would be noise).
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      if (clients.length === 0) {
        console.log("[rvc-sw] suppress: no app tabs open");
        return;
      }

      const options = {
        body: payload.body,
        tag: payload.tag || "rvc-prompt",
        renotify: true,
        requireInteraction: false,
        data: { url: payload.url || "/", sessionId: payload.sessionId },
        icon: "/favicon.svg",
        badge: "/favicon.svg",
      };
      await self.registration.showNotification(payload.title, options);
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // If an existing tab is already on the matching path, focus it.
      for (const client of allClients) {
        try {
          const u = new URL(client.url);
          if (u.pathname === targetUrl || client.url.endsWith(targetUrl)) {
            await client.focus();
            return;
          }
        } catch {}
      }
      // Otherwise focus any existing tab and navigate, or open a new one.
      if (allClients[0] && "navigate" in allClients[0]) {
        try {
          await allClients[0].focus();
          await allClients[0].navigate(targetUrl);
          return;
        } catch {}
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
