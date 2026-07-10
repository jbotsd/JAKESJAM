// Minimal service worker — exists to make the PWA installable (Chromium
// requires a fetch handler). Deliberately NO caching: this is a live
// multiplayer game served by our own box; a stale bundle is worse than a
// slow one, and Vite's content-hashed assets get normal HTTP caching.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Pass-through: default network handling.
});
