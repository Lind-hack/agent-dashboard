import { NextResponse } from "next/server";
import { VPS_AGENTS, type AgentKey } from "@/lib/agents";
import { skillsFor } from "@/lib/skills";

export const dynamic = "force-dynamic";

// GET ?agent=claude — the skills that agent can really run, for the "/" picker.
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("agent") ?? "claude";
  const agent = (VPS_AGENTS as string[]).includes(raw) ? (raw as AgentKey) : "claude";
  return NextResponse.json({
    agent,
    skills: skillsFor(agent).map(({ invoke, name, description, source }) => ({ invoke, name, description, source })),
  });
}
