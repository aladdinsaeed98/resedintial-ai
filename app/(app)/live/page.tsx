/**
 * Live tiles from GET /api/readings. Monitor-only.
 */

import { LivePage } from "@/components/LivePage";

export const dynamic = "force-dynamic";

export default function LiveRoute() {
  return <LivePage />;
}
