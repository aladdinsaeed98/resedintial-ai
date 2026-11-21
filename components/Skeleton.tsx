/**
 * Lightweight skeleton placeholders while the first poll is in flight.
 */

export function Skeleton({
  className = "",
  rows = 3,
}: {
  className?: string;
  rows?: number;
}) {
  return (
    <div className={`skeleton-stack ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}
