/**
 * Active and recent alerts. Monitor-only: no acknowledge button, no erase.
 *
 * Critical is red. Warning is amber. Cleared rows stay muted with a relative
 * time. Counts never invent a zero badge here — an empty list is copy only.
 */

"use client";

import { relativeTime } from "@/hub/relative-time";
import { useAlerts, type AlertJson } from "./useAlerts";

function when(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return relativeTime(at, now);
}

function AlertCard({ alert, now }: { alert: AlertJson; now: Date }) {
  const cleared = alert.cleared_at !== null;
  return (
    <article
      className="alert-card glass"
      data-severity={alert.severity}
      data-state={cleared ? "cleared" : "active"}
    >
      <p className="alert-kicker">
        {alert.severity}
        {cleared ? " · cleared" : ""}
        {alert.occurrence > 1 ? ` · occurrence ${alert.occurrence}` : ""}
      </p>
      <p className="alert-title">{alert.title}</p>
      <p className="alert-meta">
        {alert.system_name}
        {alert.subject ? ` · ${alert.subject}` : ""}
        {" · rules v"}
        {alert.rules_version}
      </p>
      <p className="alert-time">
        {cleared
          ? `cleared ${when(alert.cleared_at ?? alert.last_seen_at, now)}`
          : `opened ${when(alert.opened_at, now)} · last seen ${when(alert.last_seen_at, now)}`}
      </p>
    </article>
  );
}

export function AlertsView() {
  const payload = useAlerts();
  const now = new Date();
  const alerts = payload?.alerts ?? [];
  const active = alerts.filter((row) => row.cleared_at === null);
  const recent = alerts.filter((row) => row.cleared_at !== null);

  return (
    <section>
      <h1>Alerts</h1>
      <p className="sub">
        {payload
          ? `Rules v${payload.rules_version}. Monitor only — nothing here writes to equipment.`
          : "Waiting for alerts…"}
      </p>

      <h2 className="alert-heading">Active</h2>
      {active.length === 0 ? (
        <p className="alert-empty">No active alerts.</p>
      ) : (
        <div className="alert-list">
          {active.map((alert) => (
            <AlertCard key={alert.id} alert={alert} now={now} />
          ))}
        </div>
      )}

      <h2 className="alert-heading">Recent</h2>
      {recent.length === 0 ? (
        <p className="alert-empty">No cleared alerts yet.</p>
      ) : (
        <div className="alert-list">
          {recent.map((alert) => (
            <AlertCard key={alert.id} alert={alert} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
