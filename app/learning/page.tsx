import { LearningView, type LearningTab } from "@/components/learning-view";
import { coachNow } from "@/lib/coach";
import { learningOverview } from "@/lib/learning";
import { currentSession } from "@/lib/learning-sunday";
import { studiedTerms, topicsView } from "@/lib/learning-topics";
import { listItems } from "@/lib/library";
import { page } from "@/lib/guard";

export const dynamic = "force-dynamic";

const TABS: LearningTab[] = ["sunday", "review", "sources", "topics", "practice"];

async function LearningPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const items = listItems();
  const asked = (await searchParams)?.tab as LearningTab;
  return (
    <div className="mx-auto max-w-6xl">
      <LearningView overview={learningOverview(items)} topics={topicsView(items)} session={currentSession(coachNow().day)} terms={studiedTerms(items).length} tab={TABS.includes(asked) ? asked : undefined} />
      <div className="h-28" aria-hidden />
    </div>
  );
}

export default page(LearningPage);
