/**
 * Signed-in chrome: icon side rail (desktop), top bar, mobile bottom tabs.
 *
 * Nav is links only. No counts on the tabs, no HVAC controls. UserButton is
 * sign-out — it cannot start, stop, or change equipment.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  Activity,
  Bell,
  Binary,
  Home,
  MessageCircle,
  Settings,
  History,
  type LucideIcon,
} from "lucide-react";

import { APP_SCREENS } from "@/lib/screens";
import { DemoBanner } from "./DemoBanner";
import { ConnectionPill } from "./ConnectionPill";
import { useReadings, staleLabel } from "./useReadings";

const ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/live": Activity,
  "/history": History,
  "/codes": Binary,
  "/alerts": Bell,
  "/ask": MessageCircle,
  "/settings": Settings,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLinks({
  pathname,
  variant,
}: {
  pathname: string;
  variant: "rail" | "tabs";
}) {
  return (
    <>
      {APP_SCREENS.map((screen) => {
        const active = isActive(pathname, screen.href);
        const Icon = ICONS[screen.href] ?? Home;
        const className =
          variant === "rail"
            ? active
              ? "rail-link active"
              : "rail-link"
            : active
              ? "tab active"
              : "tab";
        return (
          <Link
            key={screen.href}
            href={screen.href}
            className={className}
            aria-current={active ? "page" : undefined}
            title={screen.label}
          >
            <Icon className="nav-icon" aria-hidden="true" strokeWidth={1.6} />
            <span className="tab-label">{screen.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({
  showAccount,
  children,
}: {
  showAccount: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";
  const { snapshot, banner } = useReadings();
  const systemName = snapshot?.system_name ?? "HVAC";
  const lastUpdated = snapshot?.server_time
    ? snapshot.server_time.replace("T", " ").replace("Z", " UTC")
    : "—";
  const live = Boolean(snapshot?.mqtt_connected) && !banner;
  const demo = Boolean(
    snapshot && (snapshot as { demo?: boolean }).demo === true,
  );

  return (
    <div className="app-shell">
      <aside className="side-rail" aria-label="Primary">
        <div className="rail-brand">HVAC</div>
        <nav className="rail-nav" aria-label="App">
          <NavLinks pathname={pathname} variant="rail" />
        </nav>
        <p className="rail-legal">Read only</p>
      </aside>

      <div className="shell-main">
        <header className="topbar glass">
          <div className="topbar-left">
            <span className="brand">{systemName}</span>
            <ConnectionPill
              live={live}
              label={live ? "Live" : banner || "Offline"}
            />
          </div>
          <div className="topbar-right">
            <span className="topbar-meta" title="Last hub snapshot">
              Updated {lastUpdated}
              {snapshot ? ` · stale ${staleLabel(snapshot.stale_after_seconds)}` : ""}
            </span>
            {showAccount ? (
              <div className="account">
                <UserButton
                  appearance={{
                    elements: { avatarBox: "clerk-avatar" },
                  }}
                />
              </div>
            ) : null}
          </div>
        </header>

        {demo ? <DemoBanner /> : null}

        <div className="app-body">{children}</div>

        <p className="legal">
          Read only. This page cannot start, stop, or change the equipment.
        </p>

        <nav className="tabbar glass" aria-label="App">
          <NavLinks pathname={pathname} variant="tabs" />
        </nav>
      </div>
    </div>
  );
}
