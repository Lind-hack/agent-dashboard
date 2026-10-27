import { NextResponse } from "next/server";
import { attachmentPrompt } from "@/lib/attachments";
import { repoFromLabel } from "@/lib/config";
import { askCodex, codexConversation, getIssue } from "@/lib/linear";

export const dynamic = "force-dynamic";

// Codex cloud chat, carried over Linear: GET the conversation, POST { text } to send a message.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const issue = await getIssue(id);
    if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ issue, messages: await codexConversation(issue.id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { text?: string; attachments?: unknown } | null;
  if (!body || (body.text !== undefined && typeof body.text !== "string")) return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  try {
    const issue = await getIssue(id);
    if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });
    const text = (body.text ?? "").trim() + attachmentPrompt(body.attachments).replace(/\nVPS file: [^\n]+/g, "");
    if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });
    // Name the repo every time — each mention may start a fresh Codex task that picks an environment.
    const repo = issue.labels?.nodes?.map((l) => repoFromLabel(l.name)).find(Boolean);
    await askCodex(issue.id, `${text}${repo ? `\n\n(Repo: ${repo})` : ""}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
