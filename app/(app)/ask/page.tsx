import { Suspense } from "react";

import { AskView } from "@/components/AskView";
import { Skeleton } from "@/components/Skeleton";

export const dynamic = "force-dynamic";

export default function AskPage() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <AskView />
    </Suspense>
  );
}
