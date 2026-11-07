import { redirect } from "next/navigation";
import { SetupGuide } from "@/components/setup-guide";
import { page } from "@/lib/guard";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function SetupPage() {
  const t = currentTenant();
  if (t.owner) redirect("/settings");
  return <SetupGuide name={t.name} tz={t.tz} />;
}

export default page(SetupPage);
