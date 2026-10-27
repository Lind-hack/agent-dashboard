import { Brain } from "lucide-react";
import { Dot } from "@/components/kit";
import type { BrainStatus } from "@/lib/brain";
import { ago } from "@/lib/utils";

// What the brain has been doing: one row per source (PC chats, GitHub, dashboard chats, weekly synthesis).
const LABEL: Record<string, string> = {
  "claude-chats": "Claude chats",
  "codex-chats": "Codex chats",
  "opencode-chats": "OpenCode chats",
  "hermes-chats": "Hermes chats",
  "vps-chats": "VPS local chats",
  "codex-cloud": "Codex cloud",
  graphify: "Code graphs",
  github: "GitHub commits",
  dashboard: "Dashboard chats",
  weekly: "Weekly synthesis",
  nemotron: "Nemotron",
  vault: "Vault",
  collector: "PC collector",
};

export function BrainStrip({ status }: { status: BrainStatus }) {
  const rows = Object.entries(status.sources).sort(([a], [b]) => (LABEL[a] ?? a).localeCompare(LABEL[b] ?? b));
  return (
    <section className="panel mb-6 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm">
        <Brain className="h-4 w-4 text-hermes" strokeWidth={1.75} />
        <span className="font-medium">Brain</span>
        <span className="ml-auto text-xs text-faint">
          {status.updatedAt ? `${status.queue ? `${status.queue} queued · ` : ""}updated ${ago(status.updatedAt)}` : "hasn't run yet"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">Chat summaries go into the Obsidian vault when automatic capture is enabled in Settings. Commits and graphs have their own collection feeds.</p>
      ) : (
        <ul>
          {rows.map(([k, s]) => (
            <li key={k} className="flex min-h-11 items-center gap-3 border-b border-line px-4 py-2 last:border-0">
              <Dot tone={(s.failures ?? 0) > 0 ? "bad" : s.lastOk ? "ok" : "neutral"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px]">{LABEL[k] ?? k}</span>
                {(s.failures ?? 0) > 0 && s.lastError ? (
                  <span className="block truncate text-xs text-bad">{s.lastError}</span>
                ) : s.note ? (
                  <span className="block truncate text-xs text-faint">{s.note}</span>
                ) : null}
              </span>
              <span className="tnum shrink-0 text-right text-xs text-muted">
                {s.items ? `${s.items.toLocaleString("en")} · ` : ""}
                {s.lastOk ? ago(s.lastOk) : "never"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
