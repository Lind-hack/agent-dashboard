import { BrainStrip } from "@/components/brain-strip";
import { MemoryView } from "@/components/memory-view";
import { readBrainStatus } from "@/lib/brain";
import { listItems, readSections, slimItem } from "@/lib/library";
import { memoryStats } from "@/lib/memory";
import { page } from "@/lib/guard";

export const dynamic = "force-dynamic";

async function MemoryPage() {
  const stats = await memoryStats();
  return (
    <div className="mx-auto max-w-6xl">
      <MemoryView stats={stats} items={listItems().map(slimItem)} sections={readSections()} />
      <div className="mt-10">
        <BrainStrip status={readBrainStatus()} />
      </div>
      <div className="h-28" aria-hidden />
    </div>
  );
}

export default page(MemoryPage);
