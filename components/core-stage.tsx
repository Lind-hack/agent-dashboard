"use client";

import Link from "next/link";
import { AgentLogo, type LogoState } from "@/components/agent-logo";
import { Core } from "@/components/core";
import { AGENT_HEX, AGENT_LABELS, type AgentKey } from "@/lib/agents";
import { cn } from "@/lib/utils";

// The home centrepiece: the Core with the four agents docked around it. Each dock shows the agent's
// real mark, its state and what it's on. On the phone the docks sit in a row under the core.

export type Dock = { agent: AgentKey; ready: boolean; working?: string; queued: number; note: string };

const SPOT: Record<AgentKey, string> = {
  claude: "left-0 top-[14%]",
  codex: "right-0 top-[14%] flex-row-reverse text-right",
  opencode: "left-0 bottom-[14%]",
  hermes: "right-0 bottom-[14%] flex-row-reverse text-right",
};
// Line from each dock's inner edge to the core (percent of the stage, SVG viewBox 0 0 100 100).
const WIRE: Record<AgentKey, string> = {
  claude: "M 16 22 L 38 40",
  codex: "M 84 22 L 62 40",
  opencode: "M 16 78 L 38 60",
  hermes: "M 84 78 L 62 60",
};

const stateOf = (d: Dock): LogoState => (!d.ready ? "off" : d.working ? "working" : "ready");
const lineOf = (d: Dock) => (!d.ready ? "Not set up" : d.working ? d.working : d.queued ? `${d.queued} queued` : "Idle · ready");

function DockCard({ d, className }: { d: Dock; className?: string }) {
  return (
    <Link
      href="/agents"
      className={cn("group flex max-w-[210px] items-center gap-3 rounded-[14px] p-1.5 pr-3 transition-colors hover:bg-white/[0.04]", className)}
      aria-label={`${AGENT_LABELS[d.agent]}: ${lineOf(d)}`}
    >
      <AgentLogo agent={d.agent} size="lg" state={stateOf(d)} />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium tracking-[-0.01em]">{AGENT_LABELS[d.agent]}</span>
        <span className={cn("block truncate text-xs", d.working ? "text-text/80" : "text-faint")}>{lineOf(d)}</span>
      </span>
    </Link>
  );
}

export function CoreStage({ docks, readout }: { docks: Dock[]; readout: string[] }) {
  const working = docks.filter((d) => d.working).map((d) => d.agent);
  const energy = working.length ? 0.6 + working.length * 0.1 : 0.28;
  const tints = working.map((a) => AGENT_HEX[a]);
  return (
    <section className="panel brackets relative overflow-hidden" aria-label="Agents">
      <div className="relative h-[300px] sm:h-[380px] lg:h-[440px]">
        <Core className="absolute inset-0 h-full w-full" energy={energy} tints={tints} label={working.length ? `${working.length} agents working` : "Core idle"} />
        <p className="hud-label absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap">
          <span className={cn("h-1.5 w-1.5 rounded-full", working.length ? "bg-ok shadow-[0_0_8px_var(--color-ok)]" : "bg-hud/60")} />
          core · {working.length ? `${working.length} working` : "idle"}
        </p>

        {/* Docks around the core (wide screens) */}
        <svg className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {docks.map((d) => (
            <path
              key={d.agent}
              d={WIRE[d.agent]}
              stroke={d.working ? AGENT_HEX[d.agent] : "rgb(169 228 245)"}
              strokeOpacity={d.working ? 0.7 : 0.16}
              strokeWidth={1}
              strokeDasharray={d.working ? undefined : "2 3"}
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          ))}
        </svg>
        {docks.map((d) => (
          <DockCard key={d.agent} d={d} className={cn("absolute m-3 hidden sm:flex", SPOT[d.agent])} />
        ))}

        <p className="hud-label absolute inset-x-0 bottom-4 truncate px-4 text-center !tracking-[0.14em]">{readout.join("  ·  ")}</p>
      </div>

      {/* Docks as a row (phone) */}
      <div className="grid grid-cols-2 gap-1 border-t border-line p-2 sm:hidden">
        {docks.map((d) => (
          <DockCard key={d.agent} d={d} className="max-w-none" />
        ))}
      </div>
    </section>
  );
}
