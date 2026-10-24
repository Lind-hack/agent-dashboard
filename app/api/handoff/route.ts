import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { pushInbox } from "@/lib/store";

// Called by the /handoff skill on Lind's PC (Bearer HANDOFF_TOKEN, checked in proxy.ts):
// { repo, branch, title, summary, agent? } → a VPS chat that continues that branch.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    repo?: string;
    branch?: string;
    title?: string;
    summary?: string;
    agent?: string;
  } | null;
  if (!body?.repo || !body.branch || !body.summary?.trim()) {
    return NextResponse.json({ error: "repo, branch and summary are required" }, { status: 400 });
  }
  const repos = (await listRepos().catch(() => [])).map((r) => r.name);
  if (!repos.includes(body.repo)) {
    return NextResponse.json({ error: `The VPS token can't access ${body.repo}. Add it to the GitHub token first.` }, { status: 400 });
  }
  const id = `H-${Date.now().toString(36).toUpperCase()}`;
  const title = (body.title?.trim() || body.summary.trim().split("\n")[0]).slice(0, 80);
  pushInbox({
    kind: "create",
    chat: {
      id,
      agent: body.agent === "codex" ? "codex" : "claude",
      repo: body.repo,
      title,
      fromBranch: body.branch,
      source: "handoff",
      prompt: `Hand-off from Lind's PC. Continue this work on branch \`${body.branch}\`.\n\n${body.summary.trim()}`,
    },
  });
  const origin = request.headers.get("x-forwarded-host") ? `https://${request.headers.get("x-forwarded-host")}` : new URL(request.url).origin;
  return NextResponse.json({ id, url: `${origin}/jobs/${id}` });
}
