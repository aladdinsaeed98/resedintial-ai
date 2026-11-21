/**
 * Short relative timestamps for the Alerts screen ("3 min ago").
 * Pure: pass `now` so tests do not wait.
 */

export function relativeTime(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1 min ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 5400) return "1 h ago";
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return "1 d ago";
  return `${Math.floor(seconds / 86400)} d ago`;
}
