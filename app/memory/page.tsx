import { BrainStrip } from "@/components/brain-strip";
import { MemoryJournal } from "@/components/memory-journal";
import { MemoryView } from "@/components/memory-view";
import { readBrainStatus } from "@/lib/brain";
import { PageHeader } from "@/components/kit";
import { listMemories } from "@/lib/memories";
import { memoryStats } from "@/lib/memory";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const stats = await memoryStats();
  const mine = listMemories();
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  const pinned = mine.filter((m) => m.pinned).length;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Memory"
        sub={`Ask anything you, your agents or your notes have written down — ${total.toLocaleString("en")} things to search. Tell it something new below and it remembers.`}
        readout={[mine.length > 0 && `${mine.length} written by you`, pinned > 0 && `${pinned} pinned for every agent`]}
      />
      <BrainStrip status={readBrainStatus()} />
      <MemoryView stats={stats}>
        <MemoryJournal initial={mine} />
      </MemoryView>
    </div>
  );
}
