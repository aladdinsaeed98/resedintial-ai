/**
 * Register the tiny service worker so the phone can Add to Home Screen.
 * The worker does not cache /api/readings — stale JSON must never linger.
 */

"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    void navigator.serviceWorker.register("/sw.js");
  }, []);
  return null;
}
