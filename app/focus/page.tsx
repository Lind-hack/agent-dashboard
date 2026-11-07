import { Suspense } from "react";
import { FocusView } from "@/components/focus-view";
import { page } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Focus mode — where every Coach push lands.
function FocusPage() {
  return (
    <Suspense>
      <FocusView />
    </Suspense>
  );
}

export default page(FocusPage);
