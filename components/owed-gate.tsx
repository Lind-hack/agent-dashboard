"use client";

import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Owed } from "@/lib/accountability";
import { cn } from "@/lib/utils";

// Strict blocks (v5.4): every block whose time came and went unstarted sits here, on Today and Home,
// until Lind decides — put it back into today's next free slot, or drop it and say why. Nothing
// moves itself; the reason goes on tonight's mirror.

export function OwedGate({ owed, today }: { owed: Owed[]; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [why, setWhy] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [err, setErr] = useState("");
  if (!owed.length) return null;

  async function act(o: Owed, action: "back" | "drop") {
    setBusy(`${action}:${o.id}`);
    setErr("");
    try {
      const res = await fetch("/api/plan/owed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day: o.day, id: o.id, action, reason: why[o.id] }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      setAsking(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section id="owed" aria-labelledby="owed-title" className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-bad/45 bg-[#1a0707]">
      <div className="border-b border-bad/25 px-4 py-3 sm:px-5">
        <p className="font-mono text-[10.5px] tracking-[0.18em] text-bad uppercase">Missed · decide now</p>
        <h2 id="owed-title" className="mt-1 text-[1.2rem] leading-tight font-semibold tracking-[-0.02em]">
          {owed.length === 1 ? "You skipped a block. Put it back or let it go — with a reason." : `You skipped ${owed.length} blocks. Each one needs a decision.`}
        </h2>
      </div>
      <ul>
        {owed.map((o) => (
          <li key={`${o.day}:${o.id}`} className="border-b border-bad/15 px-4 py-3 last:border-0 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="tnum font-mono text-[12px] text-bad">
                {o.day !== today ? "yesterday " : ""}
                {o.start}–{o.end}
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-medium line-through decoration-bad/60 decoration-2">{o.title}</span>
              <div className="flex gap-2">
                <button onClick={() => void act(o, "back")} disabled={!!busy} className="press flex h-10 items-center gap-1.5 rounded-[11px] bg-white px-3.5 text-[13.5px] font-semibold text-black disabled:opacity-60">
                  {busy === `back:${o.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Put it back
                </button>
                <button onClick={() => setAsking(asking === o.id ? null : o.id)} disabled={!!busy} aria-expanded={asking === o.id} className={cn("press flex h-10 items-center gap-1.5 rounded-[11px] border px-3.5 text-[13.5px] disabled:opacity-60", asking === o.id ? "border-bad text-bad" : "border-line text-muted hover:text-text")}>
                  <X className="h-4 w-4" /> Drop it
                </button>
              </div>
            </div>
            {asking === o.id && (
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(o, "drop");
                }}
              >
                <input
                  autoFocus
                  value={why[o.id] ?? ""}
                  onChange={(e) => setWhy({ ...why, [o.id]: e.target.value })}
                  placeholder="Why? The real reason — it goes on tonight's mirror."
                  aria-label={`Why you're dropping ${o.title}`}
                  className="h-11 min-w-0 flex-1 rounded-[11px] border border-line bg-black/40 px-3 text-[15px] placeholder:text-faint"
                />
                <button disabled={!!busy || (why[o.id] ?? "").trim().length < 8} className="press h-11 rounded-[11px] bg-bad px-4 text-[14px] font-semibold text-white disabled:opacity-50">
                  {busy === `drop:${o.id}` ? <LoaderCircle className="mx-auto h-4 w-4 animate-spin" /> : "Drop it"}
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="border-t border-bad/25 px-4 py-2 text-[13px] text-bad sm:px-5">{err}</p>}
    </section>
  );
}
