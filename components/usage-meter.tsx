import { Asterisk, SquareTerminal } from "lucide-react";
import type { PlanUsage } from "@/lib/usage";
import { ago, cn } from "@/lib/utils";

const AGENT = {
  claude: { name: "Claude", icon: Asterisk, color: "var(--color-claude)", deep: "var(--color-claude-deep)", tile: "from-[#f0a07f] to-[#c4613f]" },
  codex: { name: "Codex", icon: SquareTerminal, color: "var(--color-codex)", deep: "var(--color-codex-deep)", tile: "from-[#a9bcff] to-[#5168d6]" },
} as const;

function resetLabel(resetsAt: number | null | undefined) {
  if (!resetsAt) return null;
  const d = new Date(resetsAt * 1000);
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days < 1) return `resets ${ago(d.toISOString())}`;
  return `resets ${d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/Belgrade" })}`;
}

// One plan meter. Desktop follows the reference: tile, material bar, big numeral. On the phone the
// numeral moves up beside the name so the bar gets the full width.
export function UsageMeter({ agent, usage }: { agent: keyof typeof AGENT; usage: PlanUsage }) {
  const a = AGENT[agent];
  const Icon = a.icon;
  const week = usage.week?.usedPct ?? null;
  const five = usage.fiveHour?.usedPct ?? null;
  const known = week !== null;
  const pct = Math.max(0, Math.min(100, week ?? 0));
  const hot = known && pct >= 80;
  const reset = resetLabel(usage.week?.resetsAt);

  const numeral = (cls: string) => (
    <p className={cn("tnum shrink-0 text-right leading-none font-semibold tracking-[-0.05em]", hot && "text-warn", cls)}>
      {known ? pct : "—"}
      {known && <span className="ml-0.5 align-top text-[0.42em] font-medium tracking-normal text-muted">%</span>}
    </p>
  );

  return (
    <div className="flex items-center gap-4 sm:gap-5">
      <span className={cn("grid h-12 w-12 shrink-0 place-items-center self-start rounded-[14px] bg-gradient-to-br shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)] sm:h-14 sm:w-14 sm:self-center sm:rounded-2xl", a.tile)}>
        <Icon className="h-6 w-6 text-white sm:h-7 sm:w-7" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-end justify-between gap-3 sm:hidden">
          <p className="text-[15px] font-medium">{a.name}</p>
          {numeral("text-[2rem]")}
        </div>
        <div
          className="relative h-8 overflow-hidden rounded-full border border-line bg-black/40 shadow-[0_2px_10px_rgb(0_0_0/0.6)_inset] sm:h-11"
          role="meter"
          aria-label={`${a.name} weekly usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={known ? pct : undefined}
        >
          {known && (
            <div
              className="meter-fill absolute inset-y-0 left-0 rounded-full transition-[width] duration-1000 ease-[var(--ease-out-expo)]"
              style={{ width: `max(${pct}%, 2.5rem)`, ["--meter" as string]: a.color, ["--meter-deep" as string]: a.deep }}
            />
          )}
        </div>
        <p className="mt-2 text-xs leading-snug text-muted">
          <span className="hidden sm:inline">
            <span className="inline-block h-1.5 w-1.5 -translate-y-px rounded-full align-middle" style={{ background: a.color }} /> {a.name},{" "}
          </span>
          {known ? (
            <>
              weekly used
              {five !== null && <span className="tnum"> · 5-hour {five}%</span>}
              {reset && <span> · {reset}</span>}
            </>
          ) : (
            <span className="text-faint">Shows after {a.name}'s next run on the VPS</span>
          )}
        </p>
      </div>
      <div className="hidden sm:block">{numeral("w-[3.4ch] text-[3.4rem]")}</div>
    </div>
  );
}
