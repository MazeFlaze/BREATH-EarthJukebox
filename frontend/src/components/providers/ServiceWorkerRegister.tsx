"use client";

import { useEffect } from "react";
import { prewarmCoreAssets } from "@/lib/prewarm";

export function ServiceWorkerRegister() {
  useEffect(() => {
    // Chỉ kích hoạt Service Worker ở production để bảo vệ HMR ở dev
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => {
          console.info("[BREATHE] Service Worker active & caching in RAM.");
        })
        .catch((err) => console.warn("[BREATHE] Service Worker registration skipped:", err));
    }

    // Speculative in-memory prewarming in idle time
    if (typeof window !== "undefined") {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(() => {
          prewarmCoreAssets();
        });
      } else {
        setTimeout(prewarmCoreAssets, 1500);
      }
    }
  }, []);

  return null;
}
