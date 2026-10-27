"use client";

import { use, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Dot } from "@/components/kit";
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
          <a key={i} href={m[2]} target="_blank" rel="noreferrer" className="text-codex underline underline-offset-2">
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
    <div className="mx-auto max-w-3xl pb-44">
      <header className="pt-2 pb-5 lg:pt-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5 text-text">
            <Dot tone="hermes" pulse={lastRole === "you"} /> Codex cloud
          </span>
          {issue && (
            <a href={issue.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:text-text">
              {issue.identifier} <ArrowUpRight className="h-3 w-3" />
            </a>
          )}
          {issue?.state && <span>{issue.state.name}</span>}
        </div>
        <h1 className="text-[1.7rem] leading-tight font-semibold tracking-[-0.03em] text-balance">{issue?.title ?? id}</h1>
      </header>
      {error && <p className="mb-4 rounded-2xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{error}</p>}

      <div className="flex flex-col gap-4 text-[15px] leading-relaxed">
        {messages.map((m, i) =>
          m.role === "status" ? (
            <p key={i} className="text-xs text-faint">
              <Text text={m.text} />
            </p>
          ) : (
            <div
              key={i}
              className={cn(
                "max-w-[85%] whitespace-pre-wrap px-4 py-2.5",
                m.role === "you" ? "self-end rounded-[20px] rounded-br-md bg-white/[0.08]" : "panel self-start rounded-[20px] rounded-bl-md",
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
        placeholder="Message Codex (files are private dashboard links)…"
        onSend={async (text, _skills, attachments) => {
          const res = await fetch(`/api/codex/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, attachments }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
          setMessages((m) => [...m, { at: new Date().toISOString(), role: "you", text }]);
          return attachments.length ? "Sent. Files stay private; cloud Codex cannot open dashboard links. Use a VPS chat for file analysis." : "Sent — Codex replies here in a minute or two.";
        }}
      />
    </div>
  );
}
