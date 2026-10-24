import { NextResponse } from "next/server";
import type { AgentKey, TaskAgent } from "@/lib/config";
import { draftTask, transcribe } from "@/lib/groq";
import { listRepos } from "@/lib/github";
import { createAgentIssue } from "@/lib/linear";
import { pushInbox } from "@/lib/store";

const AGENTS: TaskAgent[] = ["claude", "codex", "codex-cloud"];

// New chat or task. Voice note and/or text → either a chat that runs straight away on the VPS,
// or a Linear issue (always for Codex cloud, which only listens to Linear).
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const agentRaw = String(form.get("agent") ?? "");
    const agent = AGENTS.includes(agentRaw as TaskAgent) ? (agentRaw as TaskAgent) : undefined;
    const repos = (await listRepos()).map((r) => r.name);
    const repoRaw = String(form.get("repo") ?? "");
    const repo = repos.includes(repoRaw) ? repoRaw : undefined;
    const tracked = form.get("linear") === "1" || agent === "codex-cloud";

    let text = String(form.get("text") ?? "").trim();
    if (audio instanceof Blob && audio.size > 0) {
      const name = audio instanceof File && audio.name ? audio.name : "note.webm";
      text = [text, await transcribe(audio, name)].filter(Boolean).join("\n\n");
    }
    if (!text) return NextResponse.json({ error: "Nothing was said or typed" }, { status: 400 });
    const fallbackRepo = repo ?? repos[0];
    if (!fallbackRepo) return NextResponse.json({ error: "The GitHub token can't see any repos" }, { status: 400 });

    if (tracked) {
      const draft = await draftTask(text, { agent, repo, repos, fallbackRepo });
      const { issue, note } = await createAgentIssue(draft);
      if (draft.agent !== "codex-cloud") pushInbox({ kind: "sync" });
      return NextResponse.json({
        id: issue.identifier,
        agent: draft.agent,
        repo: draft.repo,
        title: draft.title,
        transcript: text,
        issueUrl: issue.url,
        note,
        href: draft.agent === "codex-cloud" ? `/codex/${issue.identifier}` : `/jobs/${issue.identifier}`,
      });
    }

    // Untracked chat: the message is the prompt as-is.
    const chatAgent: AgentKey = agent === "codex" ? "codex" : "claude";
    const id = `C-${Date.now().toString(36).toUpperCase()}`;
    const title = text.split("\n")[0].slice(0, 80);
    pushInbox({ kind: "create", chat: { id, agent: chatAgent, repo: fallbackRepo, title, prompt: text, source: "dashboard" } });
    return NextResponse.json({ id, agent: chatAgent, repo: fallbackRepo, title, transcript: text, href: `/jobs/${id}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
