/* ============================================================
   JOYALTY ADMIN — sw.js  (PWA Service Worker)
   Must be at repo ROOT so Cloudflare serves it at /sw.js
   Scope is /admin/ — registered in admin/index.html
   ✓ Offline shell caching
   ✓ Push notification handling
   ✓ Notification click → open admin panel
============================================================ */

const CACHE = "joyalty-admin-v2";
const SHELL = [
  "/admin/",
  "/admin/index.html",
  "/admin/assets/admin.css",
  "/admin/assets/admin.js",
  "/admin/assets/admin-chat.js",
  "/admin/assets/auth.js",
  "/admin/icons/icon-192.png",
  "/admin/icons/icon-512.png",
];

// ── Install: cache shell ───────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // addAll with individual error handling so one missing icon
        // doesn't break the whole SW install
        Promise.allSettled(SHELL.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ── Fetch: cache-first for shell, network-first for API ───────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API requests
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response("{}", {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    return;
  }

  // Cache-first for shell assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // Cache successful GET responses from same origin
          if (
            response.ok &&
            request.method === "GET" &&
            url.origin === self.location.origin
          ) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(
          () =>
            caches.match("/admin/") || new Response("Offline", { status: 503 }),
        );
    }),
  );
});

// ── Push notifications ────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Joyalty Admin", body: "You have a new notification." };
  try {
    data = event.data.json();
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title || "Joyalty Admin", {
      body: data.body || "",
      icon: "/admin/icons/icon-192.png",
      badge: "/admin/icons/icon-192.png",
      tag: data.tag || "joyalty-notif",
      renotify: true,
      data: { url: data.url || "/admin/", sessionId: data.sessionId },
      actions: [
        { action: "open", title: "Open Dashboard" },
        { action: "dismiss", title: "Dismiss" },
      ],
    }),
  );
});

// ── Notification click ────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const target = event.notification.data?.url || "/admin/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing tab if open
        for (const client of clientList) {
          if (client.url.includes("/admin/") && "focus" in client) {
            client.focus();
            client.postMessage({
              type: "NOTIFICATION_CLICK",
              sessionId: event.notification.data?.sessionId,
            });
            return;
          }
        }
        // Otherwise open new tab
        if (clients.openWindow) return clients.openWindow(target);
      }),
  );
});
