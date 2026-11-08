"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel } from "@/components/kit";
import { cn } from "@/lib/utils";

// Settings → Kuvend: a link code lets Kuvend (the local workspace for Claude Code and Codex) send a
// decision to this account's Roast room and read the verdict. The code is shown once.
export function KuvendConnect() {
  const [status, setStatus] = useState<{ linked: number; lastUsedAt?: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    fetch("/api/kuvend/link", { cache: "no-store" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Couldn't reach the dashboard."));
  }, []);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    const res = await fetch("/api/kuvend/link", { method }).catch(() => null);
    const b = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(b?.error ?? "Couldn't reach the dashboard.");
    setStatus({ linked: b.linked, lastUsedAt: b.lastUsedAt });
    setCode(b.code ?? "");
  }

  const copy = (text: string, tag: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(""), 1400);
    });

  return (
    <Panel className="flex flex-col gap-4 !rounded-[14px] p-4">
      <p className="text-sm text-muted">
        Kuvend runs Claude Code and Codex on your computer. With a link, its <span className="text-text">Ask the council</span> button sends a change to your Roast room, and the verdict comes back as the next instruction.
      </p>
      {code ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Paste these into Kuvend (shown once):</p>
          {[
            { label: "Dashboard address", value: origin, tag: "url" },
            { label: "Link code", value: code, tag: "code" },
          ].map((f) => (
            <button key={f.tag} type="button" onClick={() => copy(f.value, f.tag)} className="flex min-h-11 items-center gap-3 rounded-[10px] border border-line bg-black/20 px-3 text-left hover:border-line-hi">
              <span className="w-32 shrink-0 text-xs text-faint">{f.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{f.value}</span>
              {copied === f.tag ? <Check className="h-4 w-4 shrink-0 text-ok" aria-label="Copied" /> : <Copy className="h-4 w-4 shrink-0 text-faint" aria-label="Copy" />}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-faint">
          {status === null ? "Checking…" : status.linked ? `${status.linked} computer${status.linked > 1 ? "s" : ""} linked${status.lastUsedAt ? `, last used ${new Date(status.lastUsedAt).toLocaleString()}` : ""}.` : "Not linked yet."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void call("POST")} className="press flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-50">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} {status?.linked ? "Link another computer" : "Make a link code"}
        </button>
        {!!status?.linked && (
          <button type="button" disabled={busy} onClick={() => void call("DELETE")} className={cn("press h-10 rounded-[11px] border border-line px-4 text-sm text-muted hover:text-text disabled:opacity-50")}>
            Unlink all
          </button>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </Panel>
  );
}
