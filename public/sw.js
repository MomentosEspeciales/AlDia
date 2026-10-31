// Service worker de alDia: permite abrir la app sin conexión (la API nunca se guarda en caché).
// La versión de la caché la calcula el despliegue; en local vale la de abajo.
const CACHE = "aldia-dev";
const FILES = ["./", "index.html", "styles.css?v=1", "logica.js?v=1", "cripto.js?v=1", "agenda.js?v=1", "almacen.js?v=1", "app.js?v=1", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "badge.png"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

// Red primero (para tener siempre la última versión) y caché si no hay conexión.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then(r => { if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// Avisos push (se activan en la fase 3).
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "alDia", { body: d.body || "", icon: "icon-192.png", badge: "badge.png", tag: d.tag || "aldia", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope) && "focus" in w) return w.focus();
    return self.clients.openWindow(destino);
  }));
});
