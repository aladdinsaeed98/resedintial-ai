/**
 * Tiny SVG sparkline for a live sensor when history samples exist.
 */

export function Sparkline({
  values,
  status,
}: {
  values: number[];
  status: string;
}) {
  if (!values.length || status !== "live") return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 72;
  const h = 24;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * w;
      const y = h - ((value - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
