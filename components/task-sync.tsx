"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Status = { connected: boolean; at?: string; errors: string[]; linked: number; total: number };
export function TaskSync() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/sync");
      if (!res.ok) throw new Error("Couldn’t read task sync status.");
      setStatus(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 30_000); return () => clearInterval(timer); }, [refresh]);
  async function sync() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/tasks/sync", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn’t sync tasks.");
      if (body.busy) setError("Sync is already running. It will finish in the background.");
      await refresh(); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!status?.connected) return null;
  return <div className="mt-4 rounded-xl border border-line px-4 py-3 text-sm">
    <div className="flex items-center justify-between gap-3">
      <p>TickTick · {status.linked}/{status.total} tasks linked{status.at ? ` · checked ${new Date(status.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · first sync pending"}</p>
      <button type="button" disabled={busy} onClick={() => void sync()} className="shrink-0 rounded-lg border border-line px-3 py-2 disabled:opacity-50">{busy ? "Syncing…" : "Sync now"}</button>
    </div>
    <p className="mt-1 text-xs text-muted">Tasks sync automatically every 30 seconds. Time blocks reserve work time; mark the task complete when the work is finished.</p>
    {(error || status.errors.length > 0) && <p role="status" className="mt-2 text-xs text-warn">{error || status.errors.join(" ")} Your tasks remain saved; sync will retry.</p>}
  </div>;
}
