/**
 * Animated return → supply airflow visual with delta-T.
 * Respects prefers-reduced-motion via CSS.
 */

export function AirflowVisual({
  deltaT,
  kind,
}: {
  deltaT: number | null;
  kind: string;
}) {
  return (
    <div className="airflow" data-kind={kind} aria-hidden="true">
      <div className="airflow-lane">
        <span className="airflow-label">Return</span>
        <div className="airflow-track">
          <span className="airflow-particle p1" />
          <span className="airflow-particle p2" />
          <span className="airflow-particle p3" />
        </div>
        <span className="airflow-label">Supply</span>
      </div>
      <p className="airflow-delta">
        {deltaT != null ? (
          <>
            <span className="num">{deltaT.toFixed(1)}</span>
            <span className="unit">°F ΔT</span>
          </>
        ) : (
          <span className="unit">ΔT needs two live temps</span>
        )}
      </p>
    </div>
  );
}
