import { BrainStrip } from "@/components/brain-strip";
import { MemoryView } from "@/components/memory-view";
import { readBrainStatus } from "@/lib/brain";
import { PageHeader } from "@/components/kit";
import { memoryStats } from "@/lib/memory";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const stats = await memoryStats();
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Memory"
        sub={`Ask anything you, your agents or your notes have written down — ${total.toLocaleString("en")} things to search.`}
        right={
          <a href="#atlas" className="rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-line-hi hover:bg-white/[0.04] hover:text-text">
            Browse memory
          </a>
        }
      />
      <BrainStrip status={readBrainStatus()} />
      <MemoryView stats={stats} />
    </div>
  );
}
