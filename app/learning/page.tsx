import { LearningView } from "@/components/learning-view";
import { learningOverview } from "@/lib/learning";
import { listItems, readSections } from "@/lib/library";

export const dynamic = "force-dynamic";

export default async function LearningPage() {
  const overview = learningOverview(listItems());
  return (
    <div className="mx-auto max-w-6xl">
      <LearningView overview={overview} sections={readSections()} />
      <div className="h-28" aria-hidden />
    </div>
  );
}
