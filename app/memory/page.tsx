import { MemoryView } from "@/components/memory-view";
import { PageHeader } from "@/components/kit";
import { memoryStats } from "@/lib/memory";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const stats = await memoryStats();
  const total = Object.values(stats.counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Memory" sub={`Ask anything you, your agents or your notes have written down — ${total.toLocaleString("en")} things to search.`} />
      <MemoryView stats={stats} />
    </div>
  );
}
