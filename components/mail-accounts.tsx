"use client";

import { Copy, ExternalLink, LoaderCircle, Mail, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PublicAccount } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { Panel } from "./kit";

// Email accounts (v5.1): the main Gmail plus any others. Gmail accounts are added from the PC (one
// command), Outlook with a code at microsoft.com/devicelogin, anything else over IMAP with an app password.

const field = "h-10 min-w-0 rounded-[11px] border border-line bg-black/30 px-3 text-[14px] outline-none focus:border-line-hi";
const PROVIDER: Record<PublicAccount["provider"], string> = { google: "Gmail", outlook: "Outlook", imap: "IMAP" };

export function MailAccounts({ initial, outlookReady, mainEmail }: { initial: PublicAccount[]; outlookReady: boolean; mainEmail: string | null }) {
  const [accounts, setAccounts] = useState(initial);
  const [mode, setMode] = useState<"" | "gmail" | "outlook" | "imap">("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [imap, setImap] = useState({ email: "", password: "", host: "" });
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (poll.current && clearInterval(poll.current)), []);

  const call = async (method: string, body?: unknown, q = "") => {
    const res = await fetch(`/api/accounts${q}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new Error(out?.error ?? `error ${res.status}`);
    return out;
  };

  async function startOutlook() {
    setBusy("outlook");
    setMsg(null);
    try {
      const r = await call("POST", { action: "outlook-start" });
      setCode({ user_code: r.user_code, verification_uri: r.verification_uri });
      poll.current = setInterval(async () => {
        const p = await call("POST", { action: "outlook-poll", deviceCode: r.device_code }).catch((e) => ({ state: "failed", error: e.message }));
        if (p.state === "pending") return;
        clearInterval(poll.current!);
        setCode(null);
        setBusy("");
        if (p.state === "done") {
          setMsg({ text: `Connected ${p.email}. Its mail shows up in the Inbox within 10 minutes.` });
          setAccounts((await call("GET")).accounts);
          setMode("");
        } else setMsg({ text: p.error ?? "Microsoft didn't finish the sign-in.", bad: true });
      }, Math.max(5, r.interval) * 1000);
    } catch (e) {
      setBusy("");
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    }
  }

  async function addImap() {
    setBusy("imap");
    setMsg(null);
    try {
      const r = await call("POST", { action: "imap", ...imap });
      setAccounts(r.accounts);
      setMsg({ text: `Connected ${imap.email}.` });
      setImap({ email: "", password: "", host: "" });
      setMode("");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy("");
    }
  }

  async function remove(a: PublicAccount) {
    setBusy(a.id);
    try {
      setAccounts((await call("DELETE", undefined, `?id=${encodeURIComponent(a.id)}`)).accounts);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy("");
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5">
        <Mail className="h-4 w-4 shrink-0 text-hermes" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px]">{mainEmail ?? "Main Google account"}</span>
          <span className="text-[11px] text-faint">Gmail · main · mail, calendar, drafts</span>
        </span>
      </div>
      {accounts.map((a) => (
        <div key={a.id} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5">
          <Mail className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px]">{a.email}</span>
            <span className="text-[11px] text-faint">
              {PROVIDER[a.provider]} · mail{a.calendar ? " · calendar" : ""}
              {a.drafts ? " · drafts" : ""}
            </span>
          </span>
          <button onClick={() => void remove(a)} disabled={!!busy} aria-label={`Remove ${a.email}`} className="grid h-9 w-9 place-items-center rounded-[10px] text-faint hover:bg-bad/10 hover:text-bad">
            {busy === a.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 p-3">
        {(["gmail", "outlook", "imap"] as const).map((m) => (
          <button key={m} onClick={() => setMode(mode === m ? "" : m)} aria-pressed={mode === m} className={cn("flex h-9 items-center gap-1.5 rounded-[10px] border px-3 text-[13px]", mode === m ? "border-line-hi bg-white/[0.06] text-text" : "border-line text-muted hover:text-text")}>
            <Plus className="h-3.5 w-3.5" /> {m === "gmail" ? "Gmail" : m === "outlook" ? "Outlook" : "Other (IMAP)"}
          </button>
        ))}
      </div>

      {mode === "gmail" && (
        <div className="rise border-t border-line px-4 py-3 text-[13.5px] leading-relaxed text-muted">
          <p>On your PC, run this once per account and pick the account in the Google window:</p>
          <CopyLine text='node "C:\Users\PC1\Desktop\claude\agent-dashboard-v3\handoff\google-auth.mjs" --add' />
          <p className="mt-2 text-xs text-faint">Its inbox joins the Inbox and its calendar joins Today. Refresh this page after.</p>
        </div>
      )}

      {mode === "outlook" && (
        <div className="rise border-t border-line px-4 py-3 text-[13.5px] leading-relaxed text-muted">
          {!outlookReady ? (
            <>
              <p className="text-text">One-time setup (Microsoft needs an app id of your own):</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>
                  <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" className="text-codex hover:underline">
                    entra.microsoft.com → App registrations
                  </a>{" "}
                  → New registration, any name, “Personal Microsoft accounts and any organization”, no redirect.
                </li>
                <li>Authentication → “Allow public client flows” → Yes → Save.</li>
                <li>
                  Copy the Application (client) ID, then on the VPS: <code className="font-mono text-[12px] text-text">echo OUTLOOK_CLIENT_ID=&lt;id&gt; | sudo tee -a /etc/agent-dashboard.env</code> and restart the dashboard.
                </li>
              </ol>
            </>
          ) : code ? (
            <div className="flex flex-col gap-2">
              <p>
                Open{" "}
                <a href={code.verification_uri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-codex hover:underline">
                  {code.verification_uri.replace("https://", "")} <ExternalLink className="h-3 w-3" />
                </a>{" "}
                and enter:
              </p>
              <p className="font-mono text-2xl tracking-[0.2em] text-text">{code.user_code}</p>
              <p className="flex items-center gap-2 text-xs text-faint">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Waiting for you to approve it…
              </p>
            </div>
          ) : (
            <button onClick={() => void startOutlook()} disabled={busy === "outlook"} className="flex h-10 items-center gap-2 rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-50">
              {busy === "outlook" && <LoaderCircle className="h-4 w-4 animate-spin" />} Connect Outlook
            </button>
          )}
        </div>
      )}

      {mode === "imap" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addImap();
          }}
          className="rise flex flex-col gap-2 border-t border-line px-4 py-3"
        >
          <p className="text-[13px] text-muted">iCloud, Yahoo, Zoho, your own domain… Use an app password from the provider, not your real one. Read-only.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={imap.email} onChange={(e) => setImap({ ...imap, email: e.target.value })} placeholder="you@icloud.com" aria-label="Email address" autoComplete="off" className={cn(field, "flex-1")} />
            <input value={imap.password} onChange={(e) => setImap({ ...imap, password: e.target.value })} placeholder="App password" aria-label="App password" type="password" autoComplete="off" className={cn(field, "flex-1")} />
          </div>
          <input value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} placeholder="IMAP server (only if it isn't iCloud/Yahoo/Zoho/GMX/AOL)" aria-label="IMAP server" autoComplete="off" className={field} />
          <button type="submit" disabled={busy === "imap" || !imap.email || !imap.password} className="flex h-10 items-center justify-center gap-2 self-start rounded-[11px] bg-text px-4 text-sm font-medium text-bg disabled:opacity-50">
            {busy === "imap" && <LoaderCircle className="h-4 w-4 animate-spin" />} Test & connect
          </button>
        </form>
      )}

      {msg && <p className={cn("border-t border-line px-4 py-2.5 text-[13px]", msg.bad ? "text-bad" : "text-ok")} aria-live="polite">{msg.text}</p>}
    </Panel>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-[11px] bg-black/40 py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] whitespace-nowrap text-text">{text}</code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        aria-label="Copy command"
        className="flex h-8 items-center gap-1 rounded-[8px] px-2 text-xs text-muted hover:bg-white/5 hover:text-text"
      >
        <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
