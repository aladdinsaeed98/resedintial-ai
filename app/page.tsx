/**
 * Live page shell. Title, banner, tile grid, "Read only" footer.
 *
 * No HTML form, input, or button elements. This page cannot start, stop, or
 * change equipment. Tiles are drawn by LivePage from GET /api/readings.
 */

import { LivePage } from "../components/LivePage";

export default function Page() {
  return <LivePage />;
}
