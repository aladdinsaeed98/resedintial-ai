/**
 * Shell + redesign: seven screens, placeholders, stale styling, no write UI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { loadSettings } from "../hub/config";
import { formatReading } from "../hub/format-reading";
import { glanceFromPoints } from "../hub/glance";
import { publicSnapshotFromMap } from "../hub/live";
import { groupPoints } from "../hub/tile-groups";
import { APP_SCREENS, PLACEHOLDER_COPY } from "../lib/screens";
import { benchReadings } from "../simulator/bench-publisher";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("app shell has seven screens and no count badges", () => {
  expect(APP_SCREENS.map((screen) => screen.label)).toEqual([
    "Home",
    "Live",
    "History",
    "Codes",
    "Alerts",
    "Ask",
    "Settings",
  ]);
  const shell = fs.readFileSync(path.join(REPO, "components", "AppShell.tsx"), "utf8");
  for (const screen of APP_SCREENS) {
    expect(shell).toContain(`href={screen.href}`);
    expect(shell).toContain("{screen.label}");
  }
  expect(shell).toContain("Read only");
  expect(shell.toLowerCase()).not.toContain("<button");
  expect(shell).not.toContain("tab-count");
  expect(shell).not.toMatch(/>\s*0\s*</);
  expect(shell).toContain("tab-label");
  expect(shell).toContain("side-rail");
  expect(shell).toContain("DemoBanner");
});

test("later-phase screens are styled placeholders", () => {
  const later = APP_SCREENS.filter((screen) => screen.laterPhase);
  expect(later.map((screen) => screen.label)).toEqual(["Codes", "Settings"]);
  const placeholder = fs.readFileSync(
    path.join(REPO, "components", "PlaceholderPage.tsx"),
    "utf8",
  );
  expect(placeholder).toContain("PLACEHOLDER_COPY");
  expect(PLACEHOLDER_COPY).toBe("Coming in a later phase");
  for (const screen of later) {
    const folder = screen.href.slice(1);
    const source = fs.readFileSync(
      path.join(REPO, "app", "(app)", folder, "page.tsx"),
      "utf8",
    );
    expect(source).toContain("PlaceholderPage");
    expect(source).toContain(screen.title);
    expect(source.toLowerCase()).not.toContain("<form");
    expect(source.toLowerCase()).not.toContain("<canvas");
  }
});

test("ask screen is a grounded chat UI", () => {
  const page = fs.readFileSync(path.join(REPO, "app", "(app)", "ask", "page.tsx"), "utf8");
  expect(page).toContain("AskView");
  expect(page).not.toContain("PlaceholderPage");
  const ask = fs.readFileSync(path.join(REPO, "components", "AskView.tsx"), "utf8");
  expect(ask).toContain("/api/ask");
  expect(ask).toContain("Based on");
  expect(ask).toContain("Troubleshooting history");
  expect(ask.toLowerCase()).toContain("monitor only");
});

test("stale tiles stay grey and hide the value", () => {
  const css = fs.readFileSync(path.join(REPO, "app", "globals.css"), "utf8");
  expect(css).toContain('[data-status="stale"]');
  expect(css).toContain("--stale:");
  expect(css).toContain("--cyan:");
  expect(css).toContain("--orange:");
  expect(css).toContain("--red:");
  expect(css).toContain("--bg: #000000");
  expect(css).toContain("prefers-reduced-motion");
  const tiles = fs.readFileSync(path.join(REPO, "components", "ReadingTiles.tsx"), "utf8");
  expect(tiles).toContain('stale: "Stale"');
  expect(tiles).toContain('missing: "No data yet"');
  expect(tiles).toContain('status === "live" && typeof point.value === "number"');
  expect(tiles).toContain("plain_label");
  expect(tiles).toContain("Sparkline");
});

test("home glance never invents Idle and flags stale vs cooling", () => {
  expect(
    glanceFromPoints([
      { point_id: "return_air_temp", status: "stale", value: null },
      { point_id: "supply_air_temp", status: "stale", value: null },
    ]).label,
  ).toBe("Needs attention");
  expect(
    glanceFromPoints([
      { point_id: "return_air_temp", status: "live", value: 72 },
      { point_id: "supply_air_temp", status: "live", value: 56 },
    ]),
  ).toEqual({ kind: "cooling", label: "Running normally", deltaT: 16 });
  expect(
    glanceFromPoints([
      { point_id: "return_air_temp", status: "live", value: 70 },
      { point_id: "supply_air_temp", status: "live", value: 90 },
    ]).kind,
  ).toBe("heating");
  expect(
    glanceFromPoints([{ point_id: "return_air_temp", status: "bad", value: null }]).kind,
  ).toBe("fault");
  expect(glanceFromPoints([{ point_id: "return_air_temp", status: "live", value: 72 }]).label).toBe(
    "Running normally",
  );
});

test("alerts screen uses severity colors and has no write UI", () => {
  const alerts = fs.readFileSync(path.join(REPO, "components", "AlertsView.tsx"), "utf8");
  expect(alerts).toContain("data-severity");
  expect(alerts).toContain("cleared");
  expect(alerts).toContain("What should I do?");
  expect(alerts.toLowerCase()).not.toContain("<form");
  expect(alerts.toLowerCase()).not.toContain("<button");
  expect(alerts).not.toContain("innerHTML");
  const page = fs.readFileSync(path.join(REPO, "app", "(app)", "alerts", "page.tsx"), "utf8");
  expect(page).toContain("AlertsView");
  expect(page).not.toContain("PlaceholderPage");
  const home = fs.readFileSync(path.join(REPO, "components", "HomeView.tsx"), "utf8");
  expect(home).toContain("activeCount > 0");
  expect(home).not.toMatch(/>\s*0\s*</);
  expect(home).toContain("AirflowVisual");
  const css = fs.readFileSync(path.join(REPO, "app", "globals.css"), "utf8");
  expect(css).toContain('[data-severity="critical"]');
  expect(css).toContain('[data-severity="warning"]');
});

test("history screen is a sortable table with empty-state copy", () => {
  const page = fs.readFileSync(path.join(REPO, "app", "(app)", "history", "page.tsx"), "utf8");
  expect(page).toContain("HistoryView");
  expect(page).not.toContain("PlaceholderPage");
  const history = fs.readFileSync(path.join(REPO, "components", "HistoryView.tsx"), "utf8");
  expect(history).toContain("data-table");
  expect(history).toContain("No history yet");
  expect(history).toContain("HVAC_DEMO=1");
  expect(history.toLowerCase()).not.toContain("<form");
});

test("every points.json sensor renders a live tile", () => {
  const settings = loadSettings({});
  const ids = settings.points.map((point) => point.id);
  expect(ids.length).toBeGreaterThan(2);
  const snap = publicSnapshotFromMap(settings, {}, new Date("2026-11-21T12:00:00Z"));
  expect(snap.points.map((point) => point.point_id)).toEqual(ids);
  expect(snap.points.every((point) => point.status === "missing")).toBe(true);

  const groups = groupPoints(settings.points);
  const groupedIds = groups.flatMap((group) => group.points.map((point) => point.id));
  expect(groupedIds.sort()).toEqual([...ids].sort());
  expect(groups.map((group) => group.label)).toEqual([
    "Temperatures",
    "Electrical",
    "Thermostat calls",
    "Board",
  ]);

  const tiles = fs.readFileSync(path.join(REPO, "components", "ReadingTiles.tsx"), "utf8");
  expect(tiles).toContain("data-point={point.point_id}");
  expect(tiles).toContain("No data yet");
  expect(tiles).toContain("tile-group");
  expect(tiles).not.toContain("return_air_temp === ");

  const simulated = benchReadings(0, "none").map((row) => row.point);
  expect(simulated).toEqual(ids);

  expect(formatReading(0, "bool")).toBe("Off");
  expect(formatReading(1, "bool")).toBe("On");
  expect(formatReading(5.2, "A")).toBe("5.2 A");
  expect(formatReading(0, "code")).toBe("Normal");
  expect(formatReading(3, "code")).toBe("Unknown code 3");
});

test("PWA manifest and icons exist", () => {
  const manifest = fs.readFileSync(path.join(REPO, "app", "manifest.ts"), "utf8");
  expect(manifest).toContain('theme_color: "#0a0a0a"');
  expect(manifest).toContain('display: "standalone"');
  expect(manifest).toContain("/icons/icon-192.png");
  expect(manifest).toContain("/icons/icon-512.png");
  for (const file of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
    const full = path.join(REPO, "public", "icons", file);
    expect(fs.existsSync(full)).toBe(true);
    expect(fs.statSync(full).size).toBeGreaterThan(100);
  }
  const sw = fs.readFileSync(path.join(REPO, "public", "sw.js"), "utf8");
  expect(sw).toContain("never cache /api/readings");
  expect(sw).toContain("/api/alerts");
  expect(sw).toContain("/api/history");
});
