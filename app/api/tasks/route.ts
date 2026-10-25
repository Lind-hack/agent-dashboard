import { NextResponse } from "next/server";
import { AGENT_META, VPS_AGENTS, type AgentKey, type TaskAgent } from "@/lib/agents";
import { draftTask, transcribe } from "@/lib/groq";
import { listRepos } from "@/lib/github";
import { createAgentIssue } from "@/lib/linear";
import { pushInbox } from "@/lib/store";

const TASK_AGENTS: TaskAgent[] = [...VPS_AGENTS, "codex-cloud"];
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}`;

// New chat, task or group. Voice note and/or text →
// - mode "single": one chat on the VPS, or a Linear issue (always for Codex cloud)
// - mode "ask":    the same prompt to several VPS agents at once, answers side by side
// - mode "relay":  plan → build → review across agents on one branch
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const mode = String(form.get("mode") ?? "single");
    const agentRaw = String(form.get("agent") ?? "");
    const agent = TASK_AGENTS.includes(agentRaw as TaskAgent) ? (agentRaw as TaskAgent) : undefined;
    const repos = (await listRepos()).map((r) => r.name);
    const repoRaw = String(form.get("repo") ?? "");
    const repo = repos.includes(repoRaw) ? repoRaw : undefined;
    const tracked = mode === "single" && (form.get("linear") === "1" || agent === "codex-cloud");

    let text = String(form.get("text") ?? "").trim();
    if (audio instanceof Blob && audio.size > 0) {
      const name = audio instanceof File && audio.name ? audio.name : "note.webm";
      text = [text, await transcribe(audio, name)].filter(Boolean).join("\n\n");
    }
    if (!text) return NextResponse.json({ error: "Nothing was said or typed" }, { status: 400 });
    const fallbackRepo = repo ?? repos[0] ?? "";
    const title = text.split("\n")[0].slice(0, 80);

    if (mode === "ask" || mode === "relay") {
      const picked = String(form.get("agents") ?? "")
        .split(",")
        .filter((a): a is AgentKey => VPS_AGENTS.includes(a as AgentKey));
      const gid = newId("G");
      if (mode === "ask") {
        if (picked.length < 2) return NextResponse.json({ error: "Pick at least two agents to ask" }, { status: 400 });
        for (const a of picked) {
          pushInbox({
            kind: "create",
            chat: {
              id: `${gid}-${a.toUpperCase()}`,
              agent: a,
              repo: AGENT_META[a].repo ? fallbackRepo : "",
              title,
              prompt: text,
              source: "dashboard",
              group: { id: gid, kind: "ask", step: 0, steps: picked, task: text },
            },
          });
        }
      } else {
        // Default relay: Claude plans, Codex builds, Claude reviews. Hermes doesn't work in repos.
        const steps = (picked.length === 3 ? picked : (["claude", "codex", "claude"] as AgentKey[])).filter((a) => a !== "hermes");
        if (steps.length !== 3) return NextResponse.json({ error: "A relay needs three repo agents (Hermes can't edit repos)" }, { status: 400 });
        if (!fallbackRepo) return NextResponse.json({ error: "Pick a repo for the relay" }, { status: 400 });
        pushInbox({
          kind: "create",
          chat: {
            id: `${gid}-1`,
            agent: steps[0],
            repo: fallbackRepo,
            title: `Plan: ${title.slice(0, 70)}`,
            prompt: text,
            source: "dashboard",
            group: { id: gid, kind: "relay", step: 0, steps, task: text },
          },
        });
      }
      return NextResponse.json({ id: gid, mode, transcript: text, href: `/agents/g/${gid}` });
    }

    if (tracked) {
      if (!fallbackRepo) return NextResponse.json({ error: "The GitHub token can't see any repos" }, { status: 400 });
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
    const chatAgent: AgentKey = agent && agent !== "codex-cloud" ? agent : "claude";
    const chatRepo = AGENT_META[chatAgent].repo ? fallbackRepo : "";
    if (AGENT_META[chatAgent].repo && !chatRepo) return NextResponse.json({ error: "The GitHub token can't see any repos" }, { status: 400 });
    const id = newId("C");
    pushInbox({ kind: "create", chat: { id, agent: chatAgent, repo: chatRepo, title, prompt: text, source: "dashboard" } });
    return NextResponse.json({ id, agent: chatAgent, repo: chatRepo, title, transcript: text, href: `/jobs/${id}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
