import { AgentLogo } from "@/components/agent-logo";
import type { PlanUsage } from "@/lib/usage";
import { ago, cn } from "@/lib/utils";

// Plan usage as an instrument: the agent's mark, a big tabular numeral and a 40-segment scale lit in
// the agent's colour. Unknown usage leaves the scale dark and says when it will show.

const META = {
  claude: { name: "Claude", color: "var(--color-claude)" },
  codex: { name: "Codex", color: "var(--color-codex)" },
} as const;

const SEGMENTS = 40;

function reset(resetsAt?: number | null) {
  if (!resetsAt) return null;
  const d = new Date(resetsAt * 1000);
  return d.getTime() - Date.now() < 86_400_000
    ? `resets ${ago(d.toISOString())}`
    : `resets ${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/Belgrade" })}`;
}

export function UsageGauge({ agent, usage }: { agent: keyof typeof META; usage: PlanUsage }) {
  const m = META[agent];
  const week = usage.week?.usedPct ?? null;
  const five = usage.fiveHour?.usedPct ?? null;
  const main = week !== null ? "week" : five !== null ? "fiveHour" : null;
  const pct = main ? Math.max(0, Math.min(100, (main === "week" ? week : five) ?? 0)) : null;
  const hot = pct !== null && pct >= 80;
  const lit = pct === null ? 0 : Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * SEGMENTS));
  const r = reset(main ? usage[main]?.resetsAt : null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <AgentLogo agent={agent} size="sm" state={pct === null ? "idle" : "ready"} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="hud-label">{m.name} · {main === "fiveHour" ? "5-hour" : "weekly"}</p>
          <p className="truncate text-xs text-muted">{pct === null ? `Shows after ${m.name}'s next run` : [five !== null && main === "week" ? `5-hour ${five}%` : null, r].filter(Boolean).join(" · ") || "used"}</p>
        </div>
        <p className={cn("tnum text-[2.2rem] leading-none font-semibold tracking-[-0.05em]", hot && "text-warn")}>
          {pct ?? "—"}
          {pct !== null && <span className="ml-0.5 align-top text-[0.4em] font-medium tracking-normal text-muted">%</span>}
        </p>
      </div>
      <div className="flex h-5 items-stretch gap-[3px]" role="meter" aria-label={`${m.name} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className="flex-1 rounded-[2px]"
            style={
              i < lit
                ? { background: hot ? "var(--color-warn)" : m.color, boxShadow: `0 0 8px -1px ${hot ? "var(--color-warn)" : m.color}`, opacity: 0.55 + (i / SEGMENTS) * 0.45 }
                : { background: "rgb(255 255 255 / 0.06)" }
            }
          />
        ))}
      </div>
      <div className="tnum flex justify-between font-mono text-[10px] text-faint" aria-hidden>
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
