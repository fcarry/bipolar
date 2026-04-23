// Bipolar PWA service worker. Cache-first for static assets, network-first for /api,
// IndexedDB queue for offline /api/logs POSTs.
const CACHE = "bipolar-v1";
const STATIC = ["/", "/login", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];
const QUEUE_DB = "bipolar-queue";
const QUEUE_STORE = "logs";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function openQueue() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(QUEUE_STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueLog(req) {
  const db = await openQueue();
  const headers = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const blob = await req.clone().blob();
  const body = await blob.arrayBuffer();
  await new Promise((res) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add({ url: req.url, headers, body, ts: Date.now() });
    tx.oncomplete = res;
  });
}

async function flushQueue() {
  const db = await openQueue();
  const items = await new Promise((res) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const all = tx.objectStore(QUEUE_STORE).getAll();
    all.onsuccess = () => res(all.result || []);
  });
  for (const item of items) {
    try {
      const res = await fetch(item.url, { method: "POST", headers: item.headers, body: item.body });
      if (res.ok) {
        await new Promise((r) => {
          const tx = db.transaction(QUEUE_STORE, "readwrite");
          tx.objectStore(QUEUE_STORE).clear();
          tx.oncomplete = r;
        });
      }
    } catch {
      break;
    }
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname === "/api/logs") {
    event.respondWith(
      fetch(req.clone()).catch(async () => {
        await enqueueLog(req);
        return new Response(
          JSON.stringify({ ok: false, queued: true, message: "Sin conexión — registrado para reintentar" }),
          { status: 202, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.method === "GET") {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res.ok && (req.destination === "image" || req.destination === "script" || req.destination === "style" || url.pathname === "/")) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

self.addEventListener("online", flushQueue);
self.addEventListener("sync", (e) => {
  if (e.tag === "flush-logs") e.waitUntil(flushQueue());
});

setInterval(() => {
  flushQueue().catch(() => {});
}, 60000);
