import type { TaskAgent } from "@/lib/agents";
import { CLAUDE_MARK, NOUS_MARK, OPENAI_MARK, OPENCODE_MARK } from "@/lib/agent-marks";
import { cn } from "@/lib/utils";

// An agent's identity everywhere in the OS: its real mark on a dark glass tile lit in the agent's
// colour. `state` drives the light: working = a slow light sweep around the edge, off = desaturated.

const SIZE = { xs: 20, sm: 28, md: 36, lg: 48, xl: 64 } as const;
export type LogoSize = keyof typeof SIZE;
export type LogoState = "idle" | "ready" | "working" | "off";

const TINT: Record<TaskAgent, string> = {
  claude: "var(--color-claude)",
  codex: "var(--color-codex)",
  "codex-cloud": "var(--color-hermes)",
  opencode: "var(--color-opencode)",
  hermes: "var(--color-hermes)",
};

function Mark({ agent, px }: { agent: TaskAgent; px: number }) {
  if (agent === "opencode") {
    return (
      <svg viewBox="0 0 240 300" width={px * 0.78} height={px * 0.78} aria-hidden>
        <path d={OPENCODE_MARK.frame} fill="currentColor" fillRule="evenodd" />
        <path d={OPENCODE_MARK.core} fill="currentColor" opacity={0.45} />
      </svg>
    );
  }
  const paths: string[] = agent === "claude" ? CLAUDE_MARK : agent === "hermes" ? NOUS_MARK : OPENAI_MARK;
  return (
    <svg viewBox="0 0 24 24" width={px} height={px} aria-hidden fill="currentColor" fillRule="evenodd">
      {paths.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

export function AgentLogo({ agent, size = "md", state = "ready", className, title }: { agent: TaskAgent; size?: LogoSize; state?: LogoState; className?: string; title?: string }) {
  const px = SIZE[size];
  const radius = Math.round(px * 0.3);
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      className={cn("agent-tile relative inline-grid shrink-0 place-items-center", state === "off" && "opacity-45 grayscale", className)}
      data-state={state}
      style={{ width: px, height: px, borderRadius: radius, ["--tint" as string]: TINT[agent] }}
    >
      {state === "working" && <span className="agent-sweep" style={{ borderRadius: radius }} aria-hidden />}
      <span className={cn("relative grid place-items-center", agent === "claude" ? "text-claude" : "text-text")}>
        <Mark agent={agent} px={Math.round(px * (agent === "hermes" ? 0.62 : 0.52))} />
      </span>
    </span>
  );
}
