/**
 * Signed-in chrome: brand, Clerk account, seven-screen nav, Read only footer.
 *
 * Nav is links only. No counts on the tabs, no HVAC controls. UserButton is
 * sign-out — it cannot start, stop, or change equipment.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

import { APP_SCREENS } from "@/lib/screens";

export function AppShell({
  showAccount,
  children,
}: {
  showAccount: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/";

  return (
    <div className="app">
      <header className="topbar glass">
        <span className="brand">HVAC</span>
        {showAccount ? (
          <div className="account">
            <UserButton
              appearance={{
                elements: { avatarBox: "clerk-avatar" },
              }}
            />
          </div>
        ) : null}
      </header>
      <div className="app-body">{children}</div>
      <p className="legal">Read only. This page cannot start, stop, or change the equipment.</p>
      <nav className="tabbar glass" aria-label="App">
        {APP_SCREENS.map((screen) => {
          const active =
            screen.href === "/" ? pathname === "/" : pathname.startsWith(screen.href);
          return (
            <Link
              key={screen.href}
              href={screen.href}
              className={active ? "tab active" : "tab"}
              aria-current={active ? "page" : undefined}
            >
              <span className="tab-label">{screen.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
