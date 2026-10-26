"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logo";
import { Md } from "@/components/md";
import { AGENT_LABELS, RELAY_STEPS, type AgentKey } from "@/lib/agents";
import { ago, cn } from "@/lib/utils";

type Member = {
  id: string;
  agent: AgentKey;
  step: number;
  status: string;
  prUrl?: string;
  updatedAt: string;
  answer: string | null;
  answerOk: boolean | null;
  latest: string | null;
};
type Group = { kind?: "ask" | "relay"; task?: string; steps?: AgentKey[]; members: Member[]; pending?: boolean };

// Ask-all answers side by side (stacked on the phone); a relay as its plan → build → review steps.
export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [g, setG] = useState<Group | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/api/groups/${id}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((b: Group) => !stop && setG(b))
        .catch(() => {});
    void load();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  if (!g || g.pending) return <p className="pt-8 text-sm text-muted">Starting the agents…</p>;
  const relay = g.kind === "relay";
  // For a relay, show every step, including ones that haven't started yet.
  const cards: (Member | { placeholder: true; agent: AgentKey; step: number })[] = relay
    ? (g.steps ?? []).map((a, i) => g.members.find((m) => m.step === i) ?? { placeholder: true as const, agent: a, step: i })
    : g.members;

  return (
    <div className="pb-10">
      <header className="pt-2 pb-6 lg:pt-6">
        <p className="mb-2 text-xs text-muted">{relay ? "Relay · plan → build → review" : `Asked ${g.members.length} agents`}</p>
        <h1 className="max-w-3xl text-[1.7rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{(g.task ?? "").split("\n")[0]}</h1>
      </header>

      <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-4", !relay && cards.length > 1 && "lg:grid-cols-2", relay && "lg:grid-cols-3")}>
        {cards.map((c, i) => {
          if ("placeholder" in c) {
            return (
              <div key={i} className="panel flex min-h-40 flex-col gap-2 p-5 opacity-50">
                <p className="flex items-center gap-2 text-sm">
                  <AgentLogo agent={c.agent} size="xs" /> {RELAY_STEPS[c.step]} · {AGENT_LABELS[c.agent]}
                </p>
                <p className="text-sm text-muted">Waiting for the previous step.</p>
              </div>
            );
          }
          const running = c.status === "running" || c.status === "queued";
          return (
            <article key={c.id} className="panel flex min-w-0 flex-col p-5">
              <header className="mb-3 flex items-center gap-2 text-sm">
                <AgentLogo agent={c.agent} size="sm" state={c.status === "running" ? "working" : "ready"} />
                <span className="font-medium">{relay ? `${RELAY_STEPS[c.step]} · ${AGENT_LABELS[c.agent]}` : AGENT_LABELS[c.agent]}</span>
                <span className="ml-auto text-xs text-faint">{running ? (c.status === "queued" ? "queued" : "working") : ago(c.updatedAt)}</span>
              </header>
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {c.answer ? (
                  <div className={c.answerOk === false ? "text-bad" : ""}>
                    <Md text={c.answer} />
                  </div>
                ) : (
                  <p className="animate-pulse text-sm text-muted">{c.latest ? c.latest.slice(0, 220) : "Thinking…"}</p>
                )}
              </div>
              <footer className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-xs">
                {c.prUrl && (
                  <a href={c.prUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted hover:text-text">
                    Pull request <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
                <Link href={`/jobs/${c.id}`} className="ml-auto flex items-center gap-1 text-muted hover:text-text">
                  Continue this chat <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}
