/**
 * Poll GET /api/alerts for Home's count and the Alerts screen.
 *
 * This hook cannot write. A zero count is returned as a number; the UI
 * must not paint a "0" badge from it.
 */

"use client";

import { useEffect, useState } from "react";

const POLL_MS = 5000;

export interface AlertJson {
  id: string;
  rule_id: string;
  subject: string;
  rules_version: number;
  severity: string;
  title: string;
  system_name: string;
  opened_at: string;
  last_seen_at: string;
  cleared_at: string | null;
  occurrence: number;
  detail: Record<string, unknown>;
  hint?: string;
}

export interface AlertsPayload {
  alerts: AlertJson[];
  active_count: number;
  rules_version: number;
  demo?: boolean;
}

export function useAlerts() {
  const [payload, setPayload] = useState<AlertsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/alerts", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as AlertsPayload;
        if (cancelled) return;
        setPayload(body);
      } catch {
        if (cancelled) return;
      }
    }

    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return payload;
}
