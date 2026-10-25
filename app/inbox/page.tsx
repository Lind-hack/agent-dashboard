import { InboxList, MarkAllDone } from "@/components/inbox-list";
import { PageHeader, Panel } from "@/components/kit";
import { inboxItems } from "@/lib/inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = await inboxItems().catch(() => []);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Inbox"
        sub={items.length ? `${items.length} waiting on you` : "You're clear."}
        right={<MarkAllDone keys={items.map((i) => i.key)} />}
      />
      <Panel className="overflow-hidden">
        <InboxList items={items} empty="Nothing waiting. Open PRs, finished or failed agents, failed timers and Codex replies land here." />
      </Panel>
    </div>
  );
}
