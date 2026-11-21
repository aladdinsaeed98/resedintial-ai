/**
 * Home. Status and tiles from GET /api/readings. No HVAC forms.
 */

import { HomeView } from "@/components/HomeView";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeView />;
}
