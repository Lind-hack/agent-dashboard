import { notFound } from "next/navigation";
import { LearningSource } from "@/components/learning-source";
import { readItem } from "@/lib/library";
import { page } from "@/lib/guard";

export const dynamic = "force-dynamic";

// One source: everything read out of it.
async function LearningSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const it = readItem((await params).id);
  if (!it) notFound();
  const { transcript: _transcript, learning, ...item } = it;
  return <LearningSource item={item} digest={learning} />;
}

export default page(LearningSourcePage);
