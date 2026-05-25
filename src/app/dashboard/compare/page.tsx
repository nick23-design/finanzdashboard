import { Suspense } from "react";
import { CompareView } from "@/components/compare/CompareView";

export default function ComparePage() {
  return (
    <Suspense>
      <CompareView />
    </Suspense>
  );
}
