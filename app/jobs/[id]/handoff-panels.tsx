"use client";

import { BookOpen, FileCode2, GitBranch, Laptop, LoaderCircle, MessagesSquare, NotebookPen, Puzzle, ScrollText, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Md } from "@/components/md";
import type { Imported } from "@/lib/store";
import { cn } from "@/lib/utils";

// Panels for a chat handed off from the PC: what it carries (Context) and the PC conversation before
// the hand-off (Earlier on PC).

type Source = { kind: string; label: string; detail?: string; bytes?: number };
type ContextBody = { imported: Imported; branch: string; repo: string; sources: { sources?: Source[]; error?: string; builtAt?: string } | null; dossier: string };

const KIND: Record<string, { icon: typeof Laptop; name: string }> = {
  session: { icon: Laptop, name: "Live chat" },
  dossier: { icon: Sparkles, name: "Dossier" },
  chat: { icon: MessagesSquare, name: "This chat, searchable" },
  related: { icon: MessagesSquare, name: "Related chats" },
  memory: { icon: NotebookPen, name: "Memory notes" },
  instructions: { icon: ScrollText, name: "Instructions" },
  skill: { icon: Puzzle, name: "Skills" },
  project: { icon: FileCode2, name: "Project files" },
  code: { icon: GitBranch, name: "Code" },
};
const ORDER = ["session", "dossier", "code", "chat", "related", "memory", "project", "instructions", "skill"];

const size = (b?: number) => (b === undefined ? "" : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

function carriesLine(sources: Source[]): string {
  const n = (k: string) => sources.filter((s) => s.kind === k).length;
  const notes = sources.filter((s) => s.kind === "memory").reduce((sum, s) => sum + (Number(s.label.match(/^(\d+)/)?.[1]) || 0), 0);
  const parts = [
    n("session") ? "the live chat" : "",
    n("related") ? `${n("related")} related chat${n("related") > 1 ? "s" : ""}` : "",
    notes ? `${notes} memory notes` : "",
    n("project") ? `${n("project")} project files` : "",
    n("instructions") ? `${n("instructions")} instruction files` : "",
    n("skill") ? `${n("skill")} skill${n("skill") > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return parts.length ? `Carries ${parts.slice(0, -1).join(", ")}${parts.length > 1 ? " and " : ""}${parts.at(-1)}.` : "";
}

export function ContextPanel({ jobId, dossierState }: { jobId: string; dossierState?: Imported["dossier"] }) {
  const [body, setBody] = useState<ContextBody | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    fetch(`/api/jobs/${jobId}/context`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => !stop && setBody(b))
      .catch((e) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [jobId, dossierState]); // refetch when the dossier finishes

  if (error) return <p className="text-sm text-bad">Couldn't load the context: {error}</p>;
  if (!body) return <LoaderCircle className="h-4 w-4 animate-spin text-muted" aria-label="Loading" />;

  const sources = body.sources?.sources ?? [];
  const grouped = ORDER.map((k) => ({ k, items: sources.filter((s) => s.kind === k) })).filter((g) => g.items.length);
  const building = body.imported.dossier === "building";

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[15px] leading-relaxed text-muted">
        {carriesLine(sources) || (building ? "Gathering everything this chat should know…" : "No context bundle came with this hand-off.")}
      </p>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm">
          <Sparkles className="h-4 w-4 text-hermes" strokeWidth={1.75} />
          <span className="font-medium">Dossier</span>
          <span className="ml-auto text-xs text-faint">
            {building ? "being written…" : body.imported.dossier === "failed" ? "not written" : body.sources?.builtAt ? `written ${new Date(body.sources.builtAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <div className="px-4 py-4 text-[15px] leading-relaxed">
          {body.dossier ? (
            <Md text={body.dossier} />
          ) : building ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Nemotron is reading the whole project — this chat, related chats, memory, commits and PRs. A few minutes.
            </p>
          ) : (
            <p className="text-sm text-muted">
              {body.imported.dossierError ?? body.sources?.error ?? "No dossier."} The agent still has the full chats and memory notes below.
            </p>
          )}
        </div>
      </section>

      {grouped.length > 0 && (
        <section className="panel overflow-hidden">
          {grouped.map(({ k, items }) => {
            const meta = KIND[k] ?? { icon: BookOpen, name: k };
            const Icon = meta.icon;
            return (
              <div key={k} className="border-b border-line last:border-0">
                <p className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs text-faint">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {meta.name}
                </p>
                {items.map((s, i) => (
                  <div key={i} className="flex min-h-12 items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{s.label}</span>
                      {s.detail && <span className="block truncate text-xs text-faint">{s.detail}</span>}
                    </span>
                    {s.bytes !== undefined && <span className="tnum shrink-0 text-xs text-muted">{size(s.bytes)}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}
      <p className="px-1 text-xs leading-relaxed text-faint">
        On the VPS this lives in <span className="font-mono">.handoff/</span> next to the code. The agent reads the dossier first and searches the chats before guessing.
      </p>
    </div>
  );
}

type HItem = { n: number; role: "you" | "agent" | "tool"; text: string; at?: string };
type HBlock = { kind: "you" | "agent"; text: string; at?: string } | { kind: "tools"; items: string[] };

function toBlocks(items: HItem[]): HBlock[] {
  const out: HBlock[] = [];
  for (const it of items) {
    if (it.role === "tool") {
      const last = out.at(-1);
      if (last?.kind === "tools") last.items.push(it.text);
      else out.push({ kind: "tools", items: [it.text] });
    } else out.push({ kind: it.role, text: it.text, at: it.at });
  }
  return out;
}

export function EarlierOnPc({ jobId, Tools }: { jobId: string; Tools: (p: { items: string[] }) => React.ReactNode }) {
  const [items, setItems] = useState<HItem[]>([]);
  const [start, setStart] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      setLoading(true);
      const q = before === undefined ? "" : `?before=${before}`;
      const res = await fetch(`/api/jobs/${jobId}/history${q}`, { cache: "no-store" }).catch(() => null);
      const b = (await res?.json().catch(() => null)) as { items: HItem[]; start: number; total: number } | null;
      if (b) {
        setItems((prev) => [...b.items, ...prev]);
        setStart(b.start);
        setTotal(b.total);
      }
      setLoading(false);
    },
    [jobId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const blocks = toBlocks(items);
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-relaxed">
      {start !== null && start > 0 && (
        <button onClick={() => load(start)} disabled={loading} className="self-center rounded-full border border-line px-4 py-2 text-xs text-muted hover:border-line-hi hover:text-text disabled:opacity-40">
          {loading ? "Loading…" : `Load earlier · ${start} more`}
        </button>
      )}
      {start === 0 && total > 0 && <p className="text-center text-xs text-faint">Start of the PC chat</p>}
      {blocks.map((b, i) => {
        if (b.kind === "tools") return <Tools key={i} items={b.items} />;
        if (b.kind === "you")
          return (
            <div key={i} className="max-w-[85%] self-end rounded-[20px] rounded-br-md bg-white/[0.08] px-4 py-2.5 whitespace-pre-wrap">
              {b.text}
              {b.at && <span className="tnum mt-1 block text-right text-[11px] text-faint">{new Date(b.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          );
        return (
          <div key={i} className="text-text/90">
            <Md text={b.text} />
          </div>
        );
      })}
      {!loading && total === 0 && <p className="text-sm text-muted">The PC conversation isn't readable here.</p>}
      {items.length > 0 && <p className="flex items-center gap-2 text-xs text-faint"><Laptop className="h-3.5 w-3.5" /> Handed off here — continue in the Chat tab.</p>}
    </div>
  );
}

export function HandoffStrip({ imported, status }: { imported: Imported; status: string }) {
  const preparing = status === "preparing";
  return (
    <p className={cn("mt-3 flex items-center gap-2 text-xs", preparing ? "text-claude" : "text-muted")}>
      {preparing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Laptop className="h-3.5 w-3.5" />}
      {preparing
        ? "Handed off from your PC — preparing context. You can write your first message now; it's sent when this finishes."
        : `From your PC · ${imported.mode === "native" ? "the live chat continues here" : "summary hand-off (a new session briefed from the PC chat)"}${imported.dossier === "ready" ? " · dossier ready" : imported.dossier === "failed" ? " · no dossier" : ""}`}
    </p>
  );
}
