import "server-only";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readBuildStamp(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  // Standalone Next places BUILD_ID at server-relative .next/BUILD_ID
  const candidates = [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(process.cwd(), "BUILD_ID"),
  ];
  for (const p of candidates) {
    try {
      const s = fs.readFileSync(p, "utf-8").trim();
      if (s) return s;
    } catch {
      /* ignore */
    }
  }
  // Per-process fallback: changes on every container restart.
  return String(BOOT_STAMP);
}

const BOOT_STAMP = Date.now();

const SW_TEMPLATE = (build: string) => `// Bipolar PWA service worker — auto-generated. Build: ${build}
// Strategy: network-first for HTML and API, cache-first for hashed static assets,
// IndexedDB queue for offline POST /api/logs. New build → new CACHE name → forced refresh.
const BUILD = ${JSON.stringify(build)};
const CACHE = "bipolar-" + BUILD;
const QUEUE_DB = "bipolar-queue";
const QUEUE_STORE = "logs";

self.addEventListener("install", (e) => {
  // Take over ASAP — no precache list (Next emits hashed URLs we can't enumerate).
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
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

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Offline queue for log POSTs.
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

  // API: always network (no caching of dynamic data).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.method !== "GET") return;

  // Hashed static assets: cache-first (immutable).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      }),
    );
    return;
  }

  // HTML / app routes: network-first, fall back to cached page.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
  );
});

self.addEventListener("online", flushQueue);
self.addEventListener("sync", (e) => {
  if (e.tag === "flush-logs") e.waitUntil(flushQueue());
});

setInterval(() => {
  flushQueue().catch(() => {});
}, 60000);
`;

export async function GET() {
  const build = readBuildStamp();
  return new Response(SW_TEMPLATE(build), {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
