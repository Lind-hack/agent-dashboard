import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { skillsFor } from "@/lib/skills";
import { guarded } from "@/lib/guard";

export const dynamic = "force-dynamic";

// GET ?agent=claude — the skills that agent can really run, for the "/" picker.
async function GET_(request: Request) {
  const raw = new URL(request.url).searchParams.get("agent") ?? "claude";
  const agent = (VPS_AGENTS as string[]).includes(raw) ? (raw as AgentKey) : "claude";
  return NextResponse.json({
    agent,
    skills: skillsFor(agent).map(({ invoke, name, description, source }) => ({ invoke, name, description, source })),
  });
}

export const GET = guarded(GET_, { owner: true });
