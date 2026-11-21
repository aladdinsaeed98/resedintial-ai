/**
 * The seven signed-in screens. Labels are the only nav text — no counts.
 *
 * Home / Live / Alerts / History are live. Codes and Settings stay later-phase
 * placeholders. Ask is a styled "coming soon" AI placeholder (Claude later).
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
  { href: "/history", label: "History", title: "History", laterPhase: false },
  { href: "/codes", label: "Codes", title: "Codes", laterPhase: true },
  { href: "/alerts", label: "Alerts", title: "Alerts", laterPhase: false },
  { href: "/ask", label: "Ask", title: "Ask", laterPhase: false },
  { href: "/settings", label: "Settings", title: "Settings", laterPhase: true },
];

export const PLACEHOLDER_COPY = "Coming in a later phase";
