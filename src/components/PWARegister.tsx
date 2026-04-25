"use client";

import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let reloadingForUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      // New SW activated → reload to pick up fresh JS/HTML.
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        // Force a check on every page load (cheap — sw.js has Cache-Control no-cache).
        reg.update().catch(() => {});

        const onUpdate = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              // A new SW is waiting — tell it to take over now.
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        };

        if (reg.waiting) onUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => onUpdate(reg.installing));

        // Periodic update probe while the app is open.
        setInterval(() => reg.update().catch(() => {}), 60_000);
      })
      .catch((e) => console.warn("[pwa] sw register failed:", e));
  }, []);

  return null;
}
