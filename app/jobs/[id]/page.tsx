import { readJob, readLog } from "@/lib/store";
import { JobView } from "./job-view";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = readJob(id);
  // Straight after dictating, the runner may not have pulled the issue from Linear yet.
  if (!job) {
    return (
      <p className="text-sm text-muted">
        <meta httpEquiv="refresh" content="3" />
        Waiting for the runner to pick up {id}…
      </p>
    );
  }
  return <JobView initialJob={job} initialLog={readLog(id)} />;
}
