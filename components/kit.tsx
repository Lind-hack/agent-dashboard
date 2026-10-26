import Link from "next/link";
import { cn } from "@/lib/utils";

// Small shared pieces of the Night Console v2 look. Server-safe (no hooks).

// Page title + one plain-language line + an optional mono readout (counts, state) and actions.
export function PageHeader({ title, sub, right, readout }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; readout?: (string | false | null | undefined)[] }) {
  const items = (readout ?? []).filter((x): x is string => !!x);
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 pt-2 lg:mb-9 lg:pt-5">
      <div className="min-w-0">
        <h1 className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance lg:text-[2.6rem]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-pretty text-muted">{sub}</p>}
        {items.length > 0 && (
          <p className="hud-label mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {items.map((x) => (
              <span key={x} className="whitespace-nowrap">
                {x}
              </span>
            ))}
          </p>
        )}
      </div>
      {right}
    </header>
  );
}

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

// Section heading: a HUD label, with an optional quiet right-hand note or link.
export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <h2 className="hud-label !text-[11px] !text-muted">{children}</h2>
      {right && <div className="text-xs text-muted">{right}</div>}
    </div>
  );
}

const DOT: Record<string, string> = {
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  claude: "bg-claude",
  codex: "bg-codex",
  hermes: "bg-hermes",
  opencode: "bg-opencode",
  hud: "bg-hud",
  neutral: "bg-faint",
};

// Status signal only (health, live, failed) — agents are shown by their AgentLogo, never by a dot.
export function Dot({ tone, pulse }: { tone: keyof typeof DOT | string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", DOT[tone] ?? DOT.neutral)} />}
      <span className={cn("relative h-2 w-2 rounded-full", DOT[tone] ?? DOT.neutral)} />
    </span>
  );
}

const PILL: Record<string, string> = {
  ok: "border-ok/30 text-ok",
  bad: "border-bad/35 text-bad",
  warn: "border-warn/35 text-warn",
  live: "border-hud/35 text-hud",
  neutral: "border-line-hi text-muted",
};

// A compact state chip: "running", "your turn", "failed", "PR open".
export function StatusPill({ tone = "neutral", children, pulse }: { tone?: keyof typeof PILL; children: React.ReactNode; pulse?: boolean }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px] tracking-[0.06em] uppercase", PILL[tone])}>
      {pulse && <Dot tone={tone === "live" ? "hud" : tone} pulse />}
      {children}
    </span>
  );
}

// Link-based filter control (state lives in the URL, so it's shareable and survives refresh).
export function Segmented({ items, current, label }: { items: { key: string; label: string; href: string; count?: number }[]; current: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-4 overflow-x-auto px-4 pb-1">
      <div className="inline-flex gap-1 rounded-[12px] border border-line bg-white/[0.02] p-1">
        {items.map((x) => {
          const on = x.key === current;
          return (
            <Link
              key={x.key}
              href={x.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] transition-colors duration-150",
                on ? "bg-text font-medium text-bg" : "text-muted hover:bg-white/[0.04] hover:text-text",
              )}
            >
              {x.label}
              {x.count !== undefined && x.count > 0 && <span className={cn("tnum font-mono text-[11px]", on ? "text-bg/60" : "text-faint")}>{x.count}</span>}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-7 text-sm text-pretty text-muted">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Row({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0", className)} {...rest}>
      {children}
    </div>
  );
}
