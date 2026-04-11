// admin/sw.js — Service Worker
// Handles: caching (offline shell), push notifications

const CACHE   = "joyalty-admin-v1";
const OFFLINE = [
  "/admin/",
  "/admin/index.html",
  "/admin/assets/admin.css",
  "/admin/assets/admin.js",
  "/admin/assets/auth.js",
  "/admin/icons/icon-192.png",
  "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Quintessential&display=swap",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
];

// ── Install: cache shell ──────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for shell, network-first for API ───────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Never intercept API calls
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        // Cache new successful GET responses for the admin shell
        if (res.ok && event.request.method === "GET" &&
            (url.pathname.startsWith("/admin/") || url.origin !== location.origin)) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match("/admin/") || new Response("Offline"));
    })
  );
});

// ── Push Notification handler ─────────────────────────────────
self.addEventListener("push", event => {
  let data = { title: "Joyalty Admin", body: "You have a new notification." };
  try { data = event.data.json(); } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title || "Joyalty Admin", {
      body:    data.body    || "",
      icon:    "/admin/icons/icon-192.png",
      badge:   "/admin/icons/icon-192.png",
      tag:     data.tag     || "joyalty-notif",
      data:    data.url     || "/admin/",
      actions: data.actions || [],
    })
  );
});

// ── Notification click: focus or open admin ───────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data || "/admin/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes("/admin/"));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});