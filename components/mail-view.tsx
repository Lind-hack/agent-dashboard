"use client";

import { Check, LoaderCircle, Paperclip, RefreshCw, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Mail, PileKey, Sorted } from "@/lib/gmail";
import { PILE_HUE } from "@/lib/piles";
import { cn } from "@/lib/utils";
import { CountUp } from "./motion";
import { Orb } from "./orb";

// Gmail in the Inbox: the hero ("N new since this morning" + Sort all) and the mail list.


export function SortHero({ newToday, unsorted, stats, connected }: { newToday: number; unsorted: number; stats: { sorted: number; ms: number }; connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"sort" | "refresh" | null>(null);
  const [result, setResult] = useState<{ sorted: number; ms: number } | null>(null);
  const [error, setError] = useState("");

  async function go(action: "sort" | "refresh") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
      if (action === "sort") setResult({ sorted: out.sorted ?? 0, ms: out.ms ?? 0 });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Gmail.");
    } finally {
      setBusy(null);
    }
  }

  const shown = result ?? stats;
  return (
    <section className="panel relative mb-5 flex flex-wrap items-center gap-4 overflow-hidden p-4 sm:p-5">
      <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_160px_at_0%_50%,rgb(232_121_201/0.12),transparent_70%)]" aria-hidden />
      <Orb state={busy === "sort" ? "thinking" : "idle"} className="h-14 w-14 shrink-0" />
      <div className="relative min-w-0 flex-1">
        <p className="text-lg leading-snug font-semibold tracking-[-0.02em]">
          {!connected ? "Bring your email in" : newToday ? `${newToday} new email${newToday === 1 ? "" : "s"} since this morning` : "No new email since this morning"}
        </p>
        <p className="text-sm text-muted">{!connected ? "Connect Gmail once and the Core sorts every message into the right pile." : unsorted ? `${unsorted} still unsorted — one tap and the Core puts each in the right pile.` : "Everything's in its pile. New mail is sorted every 10 minutes."}</p>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      {connected && (
        <>
          <dl className="relative flex gap-5 text-center">
            <div>
              <dd className="text-xl font-semibold">
                <CountUp value={shown.sorted} />
              </dd>
              <dt className="hud-label !text-[9px]">sorted</dt>
            </div>
            <div>
              <dd className="text-xl font-semibold">
                <CountUp value={shown.ms / 1000} format={(n) => `${n.toFixed(1)}s`} />
              </dd>
              <dt className="hud-label !text-[9px]">time</dt>
            </div>
            <div>
              <dd className="text-xl font-semibold">$0</dd>
              <dt className="hud-label !text-[9px]">cost</dt>
            </div>
          </dl>
          <div className="relative flex gap-2">
            <button onClick={() => void go("refresh")} disabled={!!busy} aria-label="Fetch new mail" className="press grid h-11 w-11 place-items-center rounded-[12px] border border-line text-muted hover:text-text disabled:opacity-40">
              <RefreshCw className={cn("h-4 w-4", busy === "refresh" && "animate-spin")} />
            </button>
            <button
              onClick={() => void go("sort")}
              disabled={!!busy}
              className="press flex h-11 items-center gap-2 rounded-[12px] bg-[linear-gradient(90deg,#e879c9,#f0a3c8)] px-4 text-sm font-semibold text-[#1a0a16] shadow-[0_12px_30px_-12px_rgb(232_121_201/0.8)] disabled:opacity-60"
            >
              {busy === "sort" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Sort all with Core
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const initials = (s: string) =>
  s
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "@";
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const when = (iso: string) => {
  const d = new Date(iso);
  return Date.now() - d.getTime() < 20 * 3600_000 ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function MailList({ messages, piles, labels, empty }: { messages: Mail[]; piles: Record<string, Sorted>; labels: Record<string, string>; empty: string }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Record<string, PileKey>>({});
  const shown = messages.filter((m) => !gone.has(m.id));
  const post = (body: unknown) => fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true }).catch(() => null);

  if (!shown.length) return <p className="px-5 py-8 text-sm text-muted">{empty}</p>;
  return (
    <ul className="stagger">
      {shown.map((m) => {
        const pile = moved[m.id] ?? piles[m.id]?.pile;
        return (
          <li key={m.id} className="group flex items-center border-b border-line last:border-0">
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${m.threadId}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 transition-colors hover:bg-white/[0.025]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-bg" style={{ background: `hsl(${hueOf(m.fromEmail)} 55% 68%)` }} aria-hidden>
                {initials(m.from)}
              </span>
              <span className="hidden w-40 shrink-0 leading-tight md:block">
                <span className={cn("block truncate text-[13.5px]", m.unread && "font-semibold")}>{m.from}</span>
                <span className="block truncate text-[11px] text-faint">{m.fromEmail.split("@")[1]}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-muted md:hidden">{m.from}</span>
                <span className="block truncate text-[14px]">
                  <span className={cn(m.unread ? "font-semibold text-text" : "text-text")}>{m.subject}</span>
                  <span className="hidden text-muted sm:inline"> · {m.snippet}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                  {pile && (
                    <span className="flex items-center gap-1" title={piles[m.id]?.why}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: PILE_HUE[pile] }} />
                      {labels[pile]}
                    </span>
                  )}
                  {m.attachments.slice(0, 2).map((a) => (
                    <span key={a} className="hidden max-w-[160px] items-center gap-1 truncate rounded-md border border-line px-1.5 sm:flex">
                      <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{a}</span>
                    </span>
                  ))}
                </span>
              </span>
              <span className="tnum shrink-0 pr-1 font-mono text-[11px] text-faint">{when(m.at)}</span>
            </a>
            <select
              aria-label={`Move "${m.subject}" to a pile`}
              value={pile ?? ""}
              onChange={(e) => {
                const p = e.target.value as PileKey;
                setMoved((x) => ({ ...x, [m.id]: p }));
                void post({ action: "move", id: m.id, pile: p });
              }}
              className="mr-1 hidden h-8 max-w-[110px] rounded-[8px] border border-line bg-bg-raised px-1.5 text-[11.5px] text-muted opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 lg:block"
            >
              {!pile && <option value="">Pile…</option>}
              {Object.entries(labels).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setGone((g) => new Set([...g, m.id]));
                void post({ action: "done", ids: [m.id] });
              }}
              aria-label={`Mark "${m.subject}" done`}
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
