"use client";

import { useState } from "react";
import { Panel } from "@/components/kit";

export function MemoryCapture({ enabled, blocked }: { enabled: boolean; blocked?: string }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/memory/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !on }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save setting");
      setOn(body.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save setting");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel className="mb-8 space-y-3 px-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <span id="memory-capture-label" className="text-[15px]">Automatically capture chat memory</span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="memory-capture-label" disabled={busy} onClick={toggle} className="min-h-11 min-w-20 rounded-lg border border-line px-4 text-sm disabled:opacity-50">{busy ? "Saving…" : on ? "On" : "Off"}</button>
      </div>
      <p className="text-sm text-muted">Summarize discussions, fixes and annoyances from Claude, Codex, OpenCode and Hermes on the VPS and PC, plus Codex cloud chats connected through Linear. Generate business and upgrade ideas as proposals with next steps.</p>
      <p className="text-xs text-faint">Opt-in. Existing history is included. After 20 minutes of inactivity, redacted chat text is sent to NVIDIA for summaries in your synced Obsidian vault. PC capture needs the installed brain collector; other cloud-only chats need a local export. Turning this off pauses queued chats and keeps saved memories.</p>
      {blocked && <p className="text-xs text-warn">{blocked}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <a href="/memory" className="inline-block text-sm text-command">View memory and collection status →</a>
    </Panel>
  );
}
