import { PageHeader } from "@/components/kit";
import { MoreLinks } from "@/components/shell";

export default function MorePage() {
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="More" />
      <MoreLinks />
    </div>
  );
}
