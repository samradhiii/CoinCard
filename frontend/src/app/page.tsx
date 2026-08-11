import { Suspense } from "react";

import { Dashboard } from "./Dashboard";

/**
 * `useSearchParams` — which `useFilterState` depends on — requires a Suspense
 * boundary in the App Router, otherwise the whole route opts out of static
 * rendering and Next fails the production build.
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
