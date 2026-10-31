import { Bot, Cpu, GitPullRequest, Inbox as InboxIcon, Layers } from "lucide-react";
import Link from "next/link";
import { InboxList, MarkAllDone } from "@/components/inbox-list";
import { Panel } from "@/components/kit";
import { MailList, SortHero } from "@/components/mail-view";
import { SectionHero } from "@/components/motion";
import { mailConnected, PILES, readDone, readMail, readPiles, readSortStats } from "@/lib/gmail";
import { inboxItems, type InboxItem } from "@/lib/inbox";
import { PILE_HUE } from "@/lib/piles";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Everything waiting on Lind in one place: his workspace (PRs, agents, the VPS) and his email,
// sorted into piles by the Core. ?k= picks the view: all | prs | agents | system | mail | mail:<pile>.
const GROUPS = {
  all: { label: "Everything", kinds: null, icon: Layers },
  prs: { label: "Pull requests", kinds: ["pr"], icon: GitPullRequest },
  agents: { label: "Agents", kinds: ["agent-done", "agent-failed", "codex-cloud"], icon: Bot },
  system: { label: "System", kinds: ["timer"], icon: Cpu },
} as const satisfies Record<string, { label: string; kinds: readonly InboxItem["kind"][] | null; icon: unknown }>;
type Group = keyof typeof GROUPS;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const raw = (await searchParams)?.k ?? "all";
  const items = await inboxItems().catch(() => [] as InboxItem[]);
  const connected = mailConnected();
  const done = readDone();
  const piles = readPiles();
  const mail = readMail();
  const messages = mail.messages.filter((m) => !done[m.id]);
  const labels = Object.fromEntries(PILES.map((p) => [p.key, p.label])) as Record<string, string>;

  const pileOf = (id: string) => piles[id]?.pile;
  const isMail = raw === "mail" || raw.startsWith("mail:");
  const pile = raw.startsWith("mail:") ? raw.slice(5) : null;
  const group: Group = !isMail && Object.hasOwn(GROUPS, raw) ? (raw as Group) : "all";
  const inGroup = (g: Group) => (GROUPS[g].kinds === null ? items : items.filter((i) => (GROUPS[g].kinds as readonly string[]).includes(i.kind)));
  const shownMail = pile ? messages.filter((m) => pileOf(m.id) === pile) : messages.filter((m) => pileOf(m.id) !== "spam");
  const shown = inGroup(group);

  const tz = process.env.DASHBOARD_TZ ?? "Europe/Belgrade";
  const dayStart = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  dayStart.setHours(0, 0, 0, 0);
  const offset = new Date().getTime() - new Date(new Date().toLocaleString("en-US", { timeZone: tz })).getTime();
  const since = dayStart.getTime() + offset;
  const newToday = messages.filter((m) => Date.parse(m.at) >= since).length;
  const unsorted = messages.filter((m) => !piles[m.id]).length;
  const reply = messages.filter((m) => pileOf(m.id) === "reply").length;

  const rail = (href: string, label: string, count: number, on: boolean, dot?: string, Icon?: typeof Layers) => (
    <Link
      key={href}
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn("flex h-9 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-[13.5px] transition-colors", on ? "bg-white/[0.07] text-text" : "text-muted hover:bg-white/[0.03] hover:text-text")}
    >
      {Icon ? <Icon className="h-4 w-4" strokeWidth={1.75} /> : <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      <span className="truncate">{label}</span>
      {count > 0 && <span className="tnum ml-auto font-mono text-[11px] text-faint">{count}</span>}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <SectionHero
        clip="inbox"
        eyebrow="Your conversations"
        title="Inbox"
        sub="A little more clarity. A lot less switching — agents, pull requests, the VPS and your email, sorted for you."
        right={!isMail && shown.length > 0 ? <MarkAllDone keys={shown.map((i) => i.key)} /> : undefined}
      />

      <SortHero newToday={newToday} unsorted={unsorted} stats={readSortStats()} connected={connected} />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Inbox views" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          <p className="hud-label hidden px-3 pt-1 pb-1.5 lg:block">Workspace</p>
          {(Object.keys(GROUPS) as Group[]).map((g) => rail(g === "all" ? "/inbox" : `/inbox?k=${g}`, GROUPS[g].label, inGroup(g).length, !isMail && group === g, undefined, GROUPS[g].icon))}
          {connected && (
            <>
              <p className="hud-label hidden px-3 pt-4 pb-1.5 lg:block">Core piles</p>
              {rail("/inbox?k=mail", "Email", messages.filter((m) => pileOf(m.id) !== "spam").length, raw === "mail", undefined, InboxIcon)}
              {PILES.map((p) => rail(`/inbox?k=mail:${p.key}`, p.label, messages.filter((m) => pileOf(m.id) === p.key).length, pile === p.key, PILE_HUE[p.key]))}
            </>
          )}
        </nav>

        <div className="min-w-0">
          {isMail ? (
            <Panel className="overflow-hidden">
              {mail.error && <p className="border-b border-line px-4 py-2.5 text-xs text-bad">Gmail: {mail.error}</p>}
              <MailList messages={shownMail} piles={piles} labels={labels} empty={pile ? `Nothing in ${labels[pile] ?? "this pile"}.` : "No email from the last 7 days."} />
            </Panel>
          ) : (
            <>
              <Panel className="overflow-hidden">
                <InboxList items={shown} empty={group === "all" ? "Nothing waiting. Open PRs, finished or failed agents, failed jobs and Codex replies land here." : "Nothing here."} />
              </Panel>
              {connected && reply > 0 && (
                <Link href="/inbox?k=mail:reply" className="panel lift mt-4 flex items-center gap-3 px-4 py-3.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-bad shadow-[0_0_10px_var(--color-bad)]" />
                  <span className="flex-1 text-sm">
                    {reply} email{reply === 1 ? "" : "s"} to reply to today
                  </span>
                  <span className="text-xs text-muted">Open pile →</span>
                </Link>
              )}
              {!connected && (
                <Panel className="mt-4 p-5 text-sm leading-relaxed text-muted">
                  <p className="text-text">Connect Gmail — once, on your PC (read-only; also refreshes Calendar):</p>
                  <pre className="mt-3 overflow-x-auto rounded-[12px] bg-black/40 px-4 py-3 font-mono text-[13px] text-text">node Desktop/claude/agent-dashboard/handoff/google-auth.mjs</pre>
                  <p className="mt-2 text-xs text-faint">Then mail lands here every 10 minutes, already sorted into piles.</p>
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
