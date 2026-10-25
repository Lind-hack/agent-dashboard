import { cn } from "@/lib/utils";

// Small shared pieces of the Agentic OS look. Server-safe (no hooks).

export function PageHeader({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 pt-2 lg:mb-9 lg:pt-6">
      <div className="min-w-0">
        <h1 className="text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance lg:text-[2.6rem]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-muted">{sub}</p>}
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

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
      <h2 className="text-[15px] font-medium tracking-[-0.01em] text-text">{children}</h2>
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
  neutral: "bg-faint",
};

export function Dot({ tone, pulse }: { tone: keyof typeof DOT | string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", DOT[tone] ?? DOT.neutral)} />}
      <span className={cn("relative h-2 w-2 rounded-full", DOT[tone] ?? DOT.neutral)} />
    </span>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-6 text-sm text-muted">
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
