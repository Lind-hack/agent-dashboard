"use client";

import { use, useEffect, useRef, useState } from "react";
import { ReplyBar } from "@/components/reply-bar";
import { ago, cn } from "@/lib/utils";

type Message = { at: string; role: "you" | "codex" | "status"; text: string };
type Issue = { identifier: string; title: string; url: string; state: { name: string } | null };

// Linkify Codex's "[View task →](<https://chatgpt.com/s/…>)" markdown links without a markdown renderer.
function Text({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(<?https?:\/\/[^)>\s]+>?\))/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\(<?(https?:\/\/[^)>\s]+)>?\)$/);
        return m ? (
          <a key={i} href={m[2]} target="_blank" rel="noreferrer" className="text-accent underline">
            {m[1]}
          </a>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

export default function CodexChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/codex/${id}`, { cache: "no-store" }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (stop) return;
      if (!res?.ok) return setError(body?.error ?? "Couldn't load");
      setError("");
      setIssue(body.issue);
      setMessages((prev) => {
        if ((body.messages?.length ?? 0) !== prev.length) setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), 50);
        return body.messages ?? [];
      });
    }
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  const lastRole = messages.at(-1)?.role;

  return (
    <div className="pb-40">
      <div className="mb-1 flex items-center gap-3 font-mono text-xs text-muted">
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-text">Codex cloud</span>
        {issue && (
          <a href={issue.url} target="_blank" rel="noreferrer" className="hover:text-text">
            {issue.identifier} ↗
          </a>
        )}
        {issue?.state && <span>{issue.state.name}</span>}
      </div>
      <h1 className="mb-6 text-xl font-semibold">{issue?.title ?? id}</h1>
      {error && <p className="mb-4 text-sm text-bad">{error}</p>}

      <div className="flex flex-col gap-3 text-sm">
        {messages.map((m, i) =>
          m.role === "status" ? (
            <p key={i} className="font-mono text-xs text-muted">
              <Text text={m.text} />
            </p>
          ) : (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5",
                m.role === "you" ? "self-end bg-accent/15" : "self-start border border-line bg-panel",
              )}
            >
              <Text text={m.text} />
              <span className="mt-1 block text-[10px] text-muted">{ago(m.at)}</span>
            </div>
          ),
        )}
        {lastRole === "you" && <p className="animate-pulse text-xs text-muted">waiting for Codex…</p>}
        <div ref={bottom} />
      </div>

      <ReplyBar
        placeholder="Message Codex…"
        onSend={async (text) => {
          const res = await fetch(`/api/codex/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
          setMessages((m) => [...m, { at: new Date().toISOString(), role: "you", text }]);
          return "Sent — Codex replies here in a minute or two.";
        }}
      />
    </div>
  );
}
