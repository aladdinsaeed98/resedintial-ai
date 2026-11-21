/**
 * Outbound GET /api/cron/rules from the home collector.
 *
 * Vercel Hobby cron is once a day, so the 24/7 collector ticks stale_sensor
 * and node_offline every 60 s. This module never talks MQTT and never
 * publishes. A failed tick is one miss — the next interval tries again.
 * No retry loop, no crash.
 */

export type CronFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number }>;

export interface CronTickResult {
  ok: boolean;
  status: number;
  skipped: boolean;
}

/** Map HUB_INGEST_URL (.../api/ingest) to the cron route. */
export function cronUrlFromIngest(ingestUrl: string): string {
  const trimmed = ingestUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/ingest")) {
    return trimmed.slice(0, -"/api/ingest".length) + "/api/cron/rules";
  }
  return `${trimmed}/api/cron/rules`;
}

/**
 * One GET. Empty secret skips (no 401 spam). Network/4xx/5xx return ok:false
 * and do not throw. The caller waits for the next 60 s interval.
 */
export async function pingCronOnce(options: {
  cronUrl: string;
  cronSecret: string;
  fetchImpl?: CronFetchLike;
}): Promise<CronTickResult> {
  const secret = options.cronSecret.trim();
  if (!secret) {
    return { ok: false, status: 0, skipped: true };
  }
  const fetchImpl = options.fetchImpl ?? (fetch as CronFetchLike);
  try {
    const response = await fetchImpl(options.cronUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
    });
    return { ok: response.ok, status: response.status, skipped: false };
  } catch {
    return { ok: false, status: 0, skipped: false };
  }
}
