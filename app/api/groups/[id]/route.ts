import { NextResponse } from "next/server";
import { listJobs, readLog } from "@/lib/store";

export const dynamic = "force-dynamic";

// One ask-all or relay group: each member's status and latest answer.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const members = listJobs()
    .filter((j) => j.group?.id === id)
    .sort((a, b) => (a.group?.step ?? 0) - (b.group?.step ?? 0) || a.agent.localeCompare(b.agent));
  if (!members.length) return NextResponse.json({ members: [], pending: true });
  return NextResponse.json({
    kind: members[0].group?.kind,
    task: members[0].group?.task,
    steps: members[0].group?.steps,
    members: members.map((j) => {
      const log = readLog(j.id, 200);
      const answer = [...log].reverse().find((e) => e.kind === "result" || e.kind === "error");
      const latest = [...log].reverse().find((e) => e.kind === "text" || e.kind === "tool");
      return {
        id: j.id,
        agent: j.agent,
        step: j.group?.step ?? 0,
        status: j.status,
        prUrl: j.prUrl,
        updatedAt: j.updatedAt,
        answer: answer?.text ?? null,
        answerOk: answer ? answer.kind === "result" && answer.ok !== false : null,
        latest: latest?.text ?? null,
      };
    }),
  });
}
