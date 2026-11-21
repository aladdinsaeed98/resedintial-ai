/**
 * Shared poll of GET /api/readings for Home, Live, and the shell top bar.
 *
 * Same stale rule as before: after stale_after_seconds from received_at the
 * client marks the tile stale even between polls. This hook cannot write.
 */

"use client";

import { useEffect, useRef, useState } from "react";

const POLL_MS = 1000;
const TICK_MS = 250;

export interface LivePointJson {
  point_id: string;
  name: string;
  plain_label?: string | null;
  description?: string | null;
  node_id: string;
  unit: string;
  status: string;
  quality: string | null;
  value: number | null;
  age_seconds: number | null;
  sparkline?: number[];
}

export interface Snapshot {
  system_name: string;
  server_time: string;
  stale_after_seconds: number;
  mqtt_connected: boolean;
  demo?: boolean;
  points: LivePointJson[];
}

/** Turn 120 into "2 min" so the subtitle is readable. Other values stay in seconds. */
export function staleLabel(seconds: number): string {
  if (seconds % 60 === 0) return String(seconds / 60) + " min";
  return String(seconds) + " s";
}

export function useReadings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [banner, setBanner] = useState("");
  const [, setTick] = useState(0);
  const syncedAt = useRef(0);
  const snapshotRef = useRef<Snapshot | null>(null);

  function hubAge(point: LivePointJson): number | null {
    if (typeof point.age_seconds !== "number") return null;
    return point.age_seconds + (performance.now() - syncedAt.current) / 1000;
  }

  function effectiveStatus(point: LivePointJson): string {
    if (point.status === "missing") return "missing";
    const age = hubAge(point);
    const current = snapshotRef.current;
    if (current && age != null && age >= current.stale_after_seconds) return "stale";
    return point.status;
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch("/api/readings", { cache: "no-store" });
        if (!response.ok) throw new Error("hub status " + response.status);
        const body = (await response.json()) as Snapshot;
        if (cancelled) return;
        snapshotRef.current = body;
        syncedAt.current = performance.now();
        setSnapshot(body);
        if (body.demo) {
          setBanner("");
        } else {
          setBanner(body.mqtt_connected ? "" : "MQTT broker not connected.");
        }
      } catch {
        if (cancelled) return;
        setBanner("Can't reach the hub.");
      }
    }

    void poll();
    const pollId = setInterval(() => {
      void poll();
    }, POLL_MS);
    const tickId = setInterval(() => {
      setTick((n) => n + 1);
    }, TICK_MS);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  return { snapshot, banner, hubAge, effectiveStatus };
}
