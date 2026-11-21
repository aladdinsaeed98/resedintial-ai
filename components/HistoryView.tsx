/**
 * Sortable History table. Demo mode fills rows; otherwise a helpful empty state.
 * Monitor-only — no forms or write controls.
 */

"use client";

import { useEffect, useMemo, useState } from "react";

import { relativeTime } from "@/hub/relative-time";
import { Skeleton } from "./Skeleton";

interface HistoryRow {
  id: string;
  recorded_at: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  point_id: string | null;
  value: number | null;
  unit: string | null;
}

type SortKey = "recorded_at" | "severity" | "title" | "kind";

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
};

function sortRows(rows: HistoryRow[], key: SortKey, dir: "asc" | "desc"): HistoryRow[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "severity") {
      return ((SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)) * mul;
    }
    if (key === "recorded_at") {
      return (Date.parse(a.recorded_at) - Date.parse(b.recorded_at)) * mul;
    }
    if (key === "kind") return a.kind.localeCompare(b.kind) * mul;
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

export function HistoryView() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("recorded_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const now = new Date();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/history", { cache: "no-store" });
        if (!response.ok) throw new Error("history " + response.status);
        const body = (await response.json()) as { rows: HistoryRow[] };
        if (!cancelled) setRows(body.rows ?? []);
      } catch {
        if (!cancelled) setRows([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(
    () => sortRows(rows ?? [], sortKey, sortDir),
    [rows, sortKey, sortDir],
  );

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" || key === "kind" ? "asc" : "desc");
    }
  }

  return (
    <section className="page fade-in">
      <header className="page-header">
        <p className="micro-label">Timeline</p>
        <h1>History</h1>
        <p className="sub">Recent delta-T samples and alert events. Read only.</p>
      </header>

      {rows === null ? (
        <Skeleton rows={5} />
      ) : sorted.length === 0 ? (
        <div className="empty-state glass">
          <p className="empty-title">No history yet</p>
          <p className="empty-copy">
            History fills as readings are stored. Run the collector against a
            database, or set HVAC_DEMO=1 in .env.local and restart npm run dev
            to preview with demo rows.
          </p>
        </div>
      ) : (
        <div className="table-wrap glass">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader
                  label="When"
                  active={sortKey === "recorded_at"}
                  dir={sortDir}
                  onSort={() => toggle("recorded_at")}
                />
                <SortHeader
                  label="Severity"
                  active={sortKey === "severity"}
                  dir={sortDir}
                  onSort={() => toggle("severity")}
                />
                <SortHeader
                  label="Kind"
                  active={sortKey === "kind"}
                  dir={sortDir}
                  onSort={() => toggle("kind")}
                />
                <SortHeader
                  label="Event"
                  active={sortKey === "title"}
                  dir={sortDir}
                  onSort={() => toggle("title")}
                />
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.id} data-severity={row.severity}>
                  <td>
                    {relativeTime(new Date(row.recorded_at), now)}
                  </td>
                  <td>
                    <span className={`status-badge ${row.severity}`}>{row.severity}</span>
                  </td>
                  <td className="micro-label">{row.kind.replace("_", " ")}</td>
                  <td>{row.title}</td>
                  <td className="alert-meta">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
