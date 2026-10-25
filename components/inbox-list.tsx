"use client";

import { Check, CircleAlert, GitPullRequest, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { InboxItem } from "@/lib/inbox";
import { ago, cn } from "@/lib/utils";

const KIND_ICON: Record<InboxItem["kind"], typeof GitPullRequest> = {
  pr: GitPullRequest,
  "agent-done": MessageSquare,
  "agent-failed": CircleAlert,
  timer: CircleAlert,
  "codex-cloud": MessageSquare,
};

const TONE: Record<InboxItem["tone"], string> = {
  claude: "text-claude",
  codex: "text-codex",
  hermes: "text-hermes",
  opencode: "text-opencode",
  ok: "text-ok",
  bad: "text-bad",
  neutral: "text-muted",
};

function markSeen(keys: string[]) {
  const body = JSON.stringify({ seen: keys });
  // Survives the navigation that opening an item starts.
  if (!navigator.sendBeacon?.("/api/inbox", new Blob([body], { type: "application/json" }))) {
    void fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  }
}

// Opening an item, or "Done", clears it from the inbox and the badge.
export function InboxList({ items, limit, empty }: { items: InboxItem[]; limit?: number; empty: string }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const shown = items.filter((i) => !gone.has(i.key)).slice(0, limit);
  const dismiss = (keys: string[]) => {
    markSeen(keys);
    setGone((g) => new Set([...g, ...keys]));
  };

  if (shown.length === 0) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return (
    <ul>
      {shown.map((i) => {
        const Icon = KIND_ICON[i.kind];
        return (
          <li key={i.key} className="group flex items-center border-b border-line last:border-0">
            <Link
              href={i.href}
              target={i.external ? "_blank" : undefined}
              onClick={() => dismiss([i.key])}
              className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 hover:bg-white/[0.02]"
            >
              <Icon className={cn("h-5 w-5 shrink-0", TONE[i.tone])} strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{i.title}</span>
                <span className="block truncate text-xs text-muted">{i.detail}</span>
              </span>
              <span className="shrink-0 pr-2 text-xs text-faint">{ago(i.at)}</span>
            </Link>
            <button
              onClick={() => dismiss([i.key])}
              aria-label={`Mark "${i.title}" done`}
              className="mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-faint hover:bg-white/5 hover:text-text"
            >
              <Check className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MarkAllDone({ keys }: { keys: string[] }) {
  const [done, setDone] = useState(false);
  if (!keys.length || done) return null;
  return (
    <button
      onClick={() => {
        markSeen(keys);
        setDone(true);
        window.location.reload();
      }}
      className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:border-line-hi hover:text-text"
    >
      Mark all done
    </button>
  );
}
