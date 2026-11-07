"use client";

import { Check, Copy, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, StatusPill } from "@/components/kit";
import { ago } from "@/lib/utils";

// Obsidian: download the plugin already set up for this account, unzip it into the vault, turn it on.
// A second device gets its own code (shown once). Unpairing stops every device.

type Status = { owner: boolean; paired: boolean; devices: number; lastSyncAt?: string };

const STEPS = [
  "Install Obsidian (obsidian.md) on your computer and open your vault — or create a new one.",
  "Download the plugin below. It already knows your dashboard and has its own sync code.",
  "Unzip it into your vault's hidden .obsidian/plugins folder, so you get .obsidian/plugins/agentic-os-sync. (Mac: ⌘⇧. shows hidden folders. Windows: View → Show → Hidden items.)",
  "In Obsidian: Settings → Community plugins → Turn on community plugins → enable “Agentic OS Sync”.",
  "That's it: it syncs every 5 minutes and after each edit. Your journal, goals and memory notes appear in the vault; your notes feed your coach and planner.",
];

export function ObsidianConnect() {
  const [s, setS] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const load = () =>
    fetch("/api/vault/code", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setS(b))
      .catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  async function another() {
    const r = await fetch("/api/vault/code", { method: "POST" }).catch(() => null);
    const b = await r?.json().catch(() => null);
    if (b?.code) {
      setCode(b.code);
      setS(b);
    }
  }

  async function unpair() {
    const r = await fetch("/api/vault/code", { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      setCode("");
      void load();
    }
  }

  if (!s) return <p className="text-sm text-muted">Loading…</p>;
  if (s.owner) return <p className="text-sm text-muted">Your vault syncs with Syncthing.</p>;
  return (
    <Panel className="!rounded-[14px] px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px]">Obsidian</p>
        {s.paired ? (
          <StatusPill tone={s.lastSyncAt ? "ok" : "warn"}>{s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : "Waiting for the first sync"}</StatusPill>
        ) : (
          <StatusPill>Not connected</StatusPill>
        )}
      </div>
      <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted">
        {STEPS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <form method="post" action="/api/vault/plugin" onSubmit={() => setTimeout(load, 1500)} className="mt-4">
        <button className="flex h-11 items-center gap-2 rounded-[12px] bg-text px-4 text-sm font-medium text-bg">
          <Download className="h-4 w-4" aria-hidden /> Download the plugin
        </button>
      </form>
      <div className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
        <p>
          On your phone: open the same vault (Obsidian Sync or iCloud brings the plugin along), or install the plugin there too and paste a code for that phone in its settings.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={another} className="h-10 rounded-[11px] border border-line px-3.5 text-sm text-text hover:bg-white/5">
            Code for another device
          </button>
          {s.paired && (
            <button onClick={unpair} className="h-10 rounded-[11px] px-3 text-sm text-faint hover:bg-white/5 hover:text-bad">
              Disconnect every device
            </button>
          )}
        </div>
        {code && (
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] bg-black/40 px-3 py-2 font-mono text-xs text-text" translate="no">
              {code}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard?.writeText(code).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              aria-label="Copy the sync code"
              className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-text"
            >
              {copied ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        )}
        {code && <p className="mt-1 text-xs text-faint">Shown once. Address: {typeof window !== "undefined" ? window.location.origin : ""}</p>}
      </div>
    </Panel>
  );
}
