import { Suspense } from "react";
import { FocusView } from "@/components/focus-view";

export const dynamic = "force-dynamic";

// Focus mode — where every Coach push lands.
export default function FocusPage() {
  return (
    <Suspense>
      <FocusView />
    </Suspense>
  );
}
