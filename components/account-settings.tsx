"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Panel } from "@/components/kit";
import { cn } from "@/lib/utils";

const send = async (method: string, body: unknown, url = "/api/me") => {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as { error?: string } | null;
  return { ok: !!res?.ok, error: res ? (json?.error ?? (res.ok ? "" : "That didn't work.")) : "Couldn't reach the dashboard." };
};

const input = "w-full rounded-[11px] border border-line bg-black/30 px-3 py-2.5 text-base outline-none focus-visible:border-hud/60 sm:text-sm";

function Note({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return (
    <p className={cn("min-h-5 text-sm", msg?.ok ? "text-ok" : "text-bad")} aria-live="polite">
      {msg?.text}
    </p>
  );
}

export function ProfileForm({ name: n0, tz: tz0, onSaved }: { name: string; tz: string; onSaved?: () => void }) {
  const [name, setName] = useState(n0);
  const [tz, setTz] = useState(tz0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [tz0];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await send("PATCH", { name, tz });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    if (r.ok) (onSaved ?? (() => window.location.reload()))();
  }
  return (
    <Panel className="flex flex-col gap-3 !rounded-[14px] px-4 py-4">
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="text-xs text-muted" htmlFor="me-name">
          Name
          <input id="me-name" name="name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} className={cn(input, "mt-1.5")} />
        </label>
        <label className="text-xs text-muted" htmlFor="me-tz">
          Time zone (plans, reminders and your day start here)
          <select id="me-tz" name="tz" value={tz} onChange={(e) => setTz(e.target.value)} className={cn(input, "mt-1.5")}>
            {[...new Set([tz0, ...zones])].map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <button disabled={busy} className="flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-30">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />} Save
          </button>
          <Note msg={msg} />
        </div>
      </form>
    </Panel>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await send("PATCH", { current, password: next });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Password changed. Your other devices are signed out." } : { ok: false, text: r.error });
    if (r.ok) {
      setCurrent("");
      setNext("");
    }
  }
  return (
    <Panel className="!rounded-[14px] px-4 py-4">
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="text-xs text-muted" htmlFor="pw-current">
          Current password
          <input id="pw-current" name="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={cn(input, "mt-1.5")} />
        </label>
        <label className="text-xs text-muted" htmlFor="pw-new">
          New password (at least 10 characters)
          <input id="pw-new" name="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={cn(input, "mt-1.5")} />
        </label>
        <div className="flex items-center gap-3">
          <button disabled={busy || !current || next.length < 10} className="h-10 rounded-[11px] border border-line px-4 text-sm hover:bg-white/5 disabled:opacity-30">
            Change password
          </button>
          <Note msg={msg} />
        </div>
      </form>
    </Panel>
  );
}

export function DangerZone() {
  const [confirm, setConfirm] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function everywhere() {
    const r = await send("POST", { signOutEverywhere: true });
    if (r.ok) window.location.href = "/login";
    else setMsg({ ok: false, text: r.error });
  }
  async function remove(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("DELETE", { password });
    if (r.ok) window.location.href = "/login";
    else setMsg({ ok: false, text: r.error });
  }
  return (
    <Panel className="flex flex-col gap-3 !rounded-[14px] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Lost a phone? Sign out on every device.</p>
        <button onClick={everywhere} className="h-10 rounded-[11px] border border-line px-4 text-sm hover:bg-white/5">
          Sign out everywhere
        </button>
      </div>
      <div className="border-t border-line pt-3">
        {!confirm ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">Delete the account and everything in it: plans, journal, memory, keys.</p>
            <button onClick={() => setConfirm(true)} className="h-10 rounded-[11px] border border-bad/40 px-4 text-sm text-bad hover:bg-bad/10">
              Delete account…
            </button>
          </div>
        ) : (
          <form onSubmit={remove} className="flex flex-col gap-2">
            <label className="text-sm text-bad" htmlFor="del-pw">
              This can&apos;t be undone. Type your password to delete everything.
            </label>
            <div className="flex gap-2">
              <input id="del-pw" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
              <button disabled={!password} className="h-11 shrink-0 rounded-[11px] bg-bad px-4 text-sm font-medium text-bg disabled:opacity-30">
                Delete forever
              </button>
            </div>
          </form>
        )}
      </div>
      <Note msg={msg} />
    </Panel>
  );
}
