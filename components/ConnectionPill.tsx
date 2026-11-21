/**
 * Live connection status in the top bar. Cyan glow only when live.
 */

export function ConnectionPill({
  live,
  label,
}: {
  live: boolean;
  label: string;
}) {
  return (
    <span className={live ? "conn-pill live" : "conn-pill"} data-live={live ? "1" : "0"}>
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-label">{label}</span>
    </span>
  );
}
