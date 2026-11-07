import { BuddyView } from "@/components/buddy-view";
import { readProfile, readThread } from "@/lib/buddy";
import { coachNow } from "@/lib/coach";
import { discipline } from "@/lib/discipline";
import { readJournal, recentJournal, vaultWritable } from "@/lib/journal";
import { page } from "@/lib/guard";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// The Buddy (v5.1): your journal and a coach-friend who knows your goals and your days.
async function BuddyPage({ searchParams }: { searchParams: Promise<{ journal?: string }> }) {
  const day = coachNow().day;
  const { journal } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl pb-24">
      <BuddyView name={currentTenant().name} initialThread={readThread().slice(-80)} today={readJournal(day)} week={recentJournal(day, 7)} focusJournal={journal === "1"} profileAt={readProfile().at ?? null} obsidian={vaultWritable()} locked={(({ score, label }) => ({ score, label }))(discipline(day))} />
    </div>
  );
}

export default page(BuddyPage);
