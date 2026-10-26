import { InboxList, MarkAllDone } from "@/components/inbox-list";
import { PageHeader, Panel, Segmented } from "@/components/kit";
import { inboxItems, type InboxItem } from "@/lib/inbox";

export const dynamic = "force-dynamic";

const GROUPS = {
  all: { label: "All", kinds: null },
  prs: { label: "PRs", kinds: ["pr"] },
  agents: { label: "Agents", kinds: ["agent-done", "agent-failed", "codex-cloud"] },
  system: { label: "System", kinds: ["timer"] },
} as const satisfies Record<string, { label: string; kinds: readonly InboxItem["kind"][] | null }>;
type Group = keyof typeof GROUPS;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const raw = (await searchParams)?.k ?? "all";
  const k: Group = Object.hasOwn(GROUPS, raw) ? (raw as Group) : "all";
  const items = await inboxItems().catch(() => [] as InboxItem[]);
  const inGroup = (g: Group) => (GROUPS[g].kinds === null ? items : items.filter((i) => (GROUPS[g].kinds as readonly string[]).includes(i.kind)));
  const shown = inGroup(k);
  const failed = items.filter((i) => i.tone === "bad").length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Inbox"
        sub={items.length ? `${items.length} waiting on you.` : "You're clear."}
        readout={[inGroup("prs").length > 0 && `${inGroup("prs").length} PRs to review`, inGroup("agents").length > 0 && `${inGroup("agents").length} from agents`, failed > 0 && `${failed} failed`]}
        right={<MarkAllDone keys={shown.map((i) => i.key)} />}
      />
      {items.length > 0 && (
        <Segmented
          label="Filter the inbox"
          current={k}
          items={(Object.keys(GROUPS) as Group[]).map((g) => ({ key: g, label: GROUPS[g].label, href: g === "all" ? "/inbox" : `/inbox?k=${g}`, count: inGroup(g).length }))}
        />
      )}
      <Panel className="overflow-hidden">
        <InboxList items={shown} empty={k === "all" ? "Nothing waiting. Open PRs, finished or failed agents, failed jobs and Codex replies land here." : "Nothing here."} />
      </Panel>
    </div>
  );
}
