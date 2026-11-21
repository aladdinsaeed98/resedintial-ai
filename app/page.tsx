/**
 * Signed-in dashboard. Live tiles plus Clerk account chrome.
 *
 * UserButton is sign-out only — it cannot start, stop, or change equipment.
 * Tiles are drawn by LivePage from GET /api/readings. No HVAC forms.
 */

import { UserButton } from "@clerk/nextjs";

import { clerkKeysConfigured } from "@/hub/clerk-keys";
import { LivePage } from "../components/LivePage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <>
      {clerkKeysConfigured() ? (
        <div className="account">
          <UserButton />
        </div>
      ) : null}
      <LivePage />
    </>
  );
}
