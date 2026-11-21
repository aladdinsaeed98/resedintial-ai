/**
 * Sortable alerts table. Monitor-only: no acknowledge button, no erase.
 *
 * Critical is red. Warning is amber. Cleared rows stay muted. Each row has a
 * "What should I do?" hint. Counts never invent a zero badge here.
 */

"use client";

import { useMemo, useState } from "react";

import { relativeTime } from "@/hub/relative-time";
import { Skeleton } from "./Skeleton";
import { useAlerts, type AlertJson } from "./useAlerts";

type SortKey = "severity" | "title" | "opened_at" | "state";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
};

function when(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return relativeTime(at, now);
}

function sortAlerts(rows: AlertJson[], key: SortKey, dir: "asc" | "desc"): AlertJson[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "severity") {
      return (
        ((SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)) * mul
      );
    }
    if (key === "state") {
      const av = a.cleared_at ? 1 : 0;
      const bv = b.cleared_at ? 1 : 0;
      return (av - bv) * mul;
    }
    if (key === "opened_at") {
      return (Date.parse(a.opened_at) - Date.parse(b.opened_at)) * mul;
    }
    return a.title.localeCompare(b.title) * mul;
  });
}

function SortHeader({
  label,
  active,
  dir,
  onSort,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onSort: () => void;
}) {
  return (
    <th scope="col">
      <span
        className={active ? "sort-control active" : "sort-control"}
        role="button"
        tabIndex={0}
        onClick={onSort}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSort();
          }
        }}
      >
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </span>
    </th>
  );
}

export function AlertsView() {
  const payload = useAlerts();
  const now = new Date();
  const [sortKey, setSortKey] = useState<SortKey>("opened_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows = useMemo(
    () => sortAlerts(payload?.alerts ?? [], sortKey, sortDir),
    [payload, sortKey, sortDir],
  );

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Faults</p>
        <h1>Alerts</h1>
        <p className="sub">
          {payload
            ? `Rules v${payload.rules_version}. Monitor only — nothing here writes to equipment.`
            : "Waiting for alerts…"}
        </p>
      </header>

      {!payload ? (
        <Skeleton rows={4} />
      ) : rows.length === 0 ? (
        <div className="empty-state glass">
          <p className="empty-title">No alerts yet</p>
          <p className="empty-copy">
            Alerts appear when the rules engine fires. Start the collector and
            simulator (or set HVAC_DEMO=1 locally), confirm Postgres migrations
            are applied, then refresh this page.
          </p>
        </div>
      ) : (
        <div className="table-wrap glass">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader
                  label="Severity"
                  active={sortKey === "severity"}
                  dir={sortDir}
                  onSort={() => toggle("severity")}
                />
                <SortHeader
                  label="Alert"
                  active={sortKey === "title"}
                  dir={sortDir}
                  onSort={() => toggle("title")}
                />
                <SortHeader
                  label="State"
                  active={sortKey === "state"}
                  dir={sortDir}
                  onSort={() => toggle("state")}
                />
                <SortHeader
                  label="Opened"
                  active={sortKey === "opened_at"}
                  dir={sortDir}
                  onSort={() => toggle("opened_at")}
                />
                <th scope="col">What should I do?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((alert) => {
                const cleared = alert.cleared_at !== null;
                return (
                  <tr
                    key={alert.id}
                    className="alert-card"
                    data-severity={alert.severity}
                    data-state={cleared ? "cleared" : "active"}
                  >
                    <td>
                      <span className={`status-badge ${alert.severity}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td>
                      <div className="alert-title">{alert.title}</div>
                      <div className="alert-meta">
                        {alert.system_name}
                        {alert.subject ? ` · ${alert.subject}` : ""}
                        {" · rules v"}
                        {alert.rules_version}
                        {alert.occurrence > 1 ? ` · occurrence ${alert.occurrence}` : ""}
                      </div>
                    </td>
                    <td>{cleared ? "cleared" : "active"}</td>
                    <td className="alert-time">
                      {cleared
                        ? `cleared ${when(alert.cleared_at ?? alert.last_seen_at, now)}`
                        : `opened ${when(alert.opened_at, now)}`}
                    </td>
                    <td className="alert-hint">
                      {alert.hint ||
                        "Check Live readings. Owner checks first; line-voltage work is for a technician."}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
