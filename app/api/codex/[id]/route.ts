import { NextResponse } from "next/server";
import { repoFromLabel } from "@/lib/config";
import { askCodex, codexConversation, getIssue } from "@/lib/linear";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Codex cloud chat, carried over Linear: GET the conversation, POST { text } to send a message.
async function GET_(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const issue = await getIssue(id);
    if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ issue, messages: await codexConversation(issue.id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

async function POST_(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  if (!body?.text?.trim()) return NextResponse.json({ error: "empty message" }, { status: 400 });
  try {
    const issue = await getIssue(id);
    if (!issue) return NextResponse.json({ error: "not found" }, { status: 404 });
    // Name the repo every time — each mention may start a fresh Codex task that picks an environment.
    const repo = issue.labels?.nodes?.map((l) => repoFromLabel(l.name)).find(Boolean);
    await askCodex(issue.id, `${body.text.trim()}${repo ? `\n\n(Repo: ${repo})` : ""}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = guarded(GET_, { owner: true });
export const POST = guarded(POST_, { owner: true });
