import { PageHeader } from "@/components/kit";
import { MoreLinks } from "@/components/shell";
import { page } from "@/lib/guard";
import { isOwner } from "@/lib/tenant";

function MorePage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="More" />
      <MoreLinks owner={isOwner()} />
    </div>
  );
}

export default page(MorePage);
