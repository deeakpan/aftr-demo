import { Suspense } from "react";
import { LaunchesClient } from "./launches-client";

export default function LaunchesPage() {
  return (
    <Suspense fallback={null}>
      <LaunchesClient />
    </Suspense>
  );
}
