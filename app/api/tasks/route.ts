import { NextResponse } from "next/server";
import { REPO_KEYS, type AgentKey, type RepoKey } from "@/lib/config";
import { draftTask, transcribe } from "@/lib/groq";
import { createAgentIssue } from "@/lib/linear";
import { pushInbox } from "@/lib/store";

// Voice note or typed text → Linear issue labelled for Claude or Codex.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const agentRaw = String(form.get("agent") ?? "auto");
    const repoRaw = String(form.get("repo") ?? "auto");
    const agent = agentRaw === "claude" || agentRaw === "codex" ? (agentRaw as AgentKey) : undefined;
    const repo = REPO_KEYS.includes(repoRaw as RepoKey) ? (repoRaw as RepoKey) : undefined;

    let text = String(form.get("text") ?? "").trim();
    if (audio instanceof Blob && audio.size > 0) {
      const name = audio instanceof File && audio.name ? audio.name : "note.webm";
      text = [text, await transcribe(audio, name)].filter(Boolean).join("\n\n");
    }
    if (!text) return NextResponse.json({ error: "Nothing was said or typed" }, { status: 400 });

    const draft = await draftTask(text, { agent, repo });
    const { issue, note } = await createAgentIssue(draft);
    // Claude issues are picked up by the runner; nudge it so it doesn't wait for the next poll.
    if (draft.agent === "claude") pushInbox({ kind: "sync" });
    return NextResponse.json({ transcript: text, draft, issue: { identifier: issue.identifier, url: issue.url }, note });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
