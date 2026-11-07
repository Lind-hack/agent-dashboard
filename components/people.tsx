"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, StatusPill } from "@/components/kit";
import { ago } from "@/lib/utils";

// The owner's invite codes and accounts.
type View = {
  users: { id: string; name: string; email: string; createdAt: string; disabled: boolean; setupDone: boolean }[];
  invites: { code: string; note?: string; createdAt: string }[];
};

export function People() {
  const [v, setV] = useState<View | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/people", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setV(b))
      .catch(() => {});
  }, []);

  async function act(body: Record<string, string>) {
    setBusy(true);
    const res = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (res?.ok) setV(await res.json());
  }

  async function copy(code: string) {
    const link = `${window.location.origin}/signup`;
    await navigator.clipboard?.writeText(`Your invite to my dashboard: ${link}\nInvite code: ${code}`).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(""), 2000);
  }

  if (!v) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-2">
      <Panel className="!rounded-[14px] px-4 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: "invite", note }).then(() => setNote(""));
          }}
          className="flex gap-2"
        >
          <label className="sr-only" htmlFor="invite-note">
            Who it's for
          </label>
          <input
            id="invite-note"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who it's for (optional)…"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-[11px] border border-line bg-black/30 px-3 py-2.5 text-base outline-none focus-visible:border-hud/60 sm:text-sm"
          />
          <button disabled={busy} className="flex h-11 shrink-0 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} New invite
          </button>
        </form>
        {v.invites.length > 0 && (
          <ul className="mt-3 flex flex-col border-t border-line pt-2">
            {v.invites.map((i) => (
              <li key={i.code} className="flex min-h-11 items-center gap-2 text-sm">
                <span className="font-mono tracking-wider" translate="no">
                  {i.code}
                </span>
                <span className="min-w-0 flex-1 truncate text-faint">{i.note}</span>
                <button onClick={() => copy(i.code)} className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-muted hover:bg-white/5 hover:text-text" aria-label={`Copy invite ${i.code}`}>
                  {copied === i.code ? <Check className="h-4 w-4 text-ok" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  <span className="hidden sm:inline">{copied === i.code ? "Copied" : "Copy"}</span>
                </button>
                <button onClick={() => act({ action: "revoke", code: i.code })} className="h-9 rounded-[10px] px-2.5 text-faint hover:bg-white/5 hover:text-bad">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {v.users.length === 0 ? (
        <p className="px-1 text-sm text-muted">No one else has an account yet.</p>
      ) : (
        <Panel className="overflow-hidden">
          {v.users.map((u) => (
            <div key={u.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">{u.name}</span>
                <span className="block truncate text-xs text-faint">
                  {u.email} · joined {ago(u.createdAt)}
                </span>
              </span>
              {u.disabled ? <StatusPill tone="bad">Paused</StatusPill> : <StatusPill tone={u.setupDone ? "ok" : "warn"}>{u.setupDone ? "Set up" : "Setting up"}</StatusPill>}
              <button onClick={() => act({ action: u.disabled ? "enable" : "disable", id: u.id })} className="h-9 rounded-[10px] px-2.5 text-sm text-muted hover:bg-white/5 hover:text-text">
                {u.disabled ? "Resume" : "Pause"}
              </button>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
