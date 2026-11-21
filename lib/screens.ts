/**
 * The seven signed-in screens. Labels are the only nav text — no counts.
 *
 * History, Codes, Ask, and Settings are placeholders until later phases.
 * Home and Live read GET /api/readings. Alerts reads GET /api/alerts.
 * Nothing here writes.
 */

export interface AppScreen {
  href: string;
  label: string;
  title: string;
  laterPhase: boolean;
}

export const APP_SCREENS: readonly AppScreen[] = [
  { href: "/", label: "Home", title: "Home", laterPhase: false },
  { href: "/live", label: "Live", title: "Live", laterPhase: false },
  { href: "/history", label: "History", title: "History", laterPhase: true },
  { href: "/codes", label: "Codes", title: "Codes", laterPhase: true },
  { href: "/alerts", label: "Alerts", title: "Alerts", laterPhase: false },
  { href: "/ask", label: "Ask", title: "Ask", laterPhase: true },
  { href: "/settings", label: "Settings", title: "Settings", laterPhase: true },
];

export const PLACEHOLDER_COPY = "Coming in a later phase";
