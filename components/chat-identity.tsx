import type { ReactNode } from "react";
import { AgentLogo, type LogoState } from "@/components/agent-logo";
import { AGENT_LABELS, AGENT_META, type TaskAgent } from "@/lib/agents";

// The same identity anchors the chat header, the new-chat view and the pinned composer.
export function ChatIdentity({ agent, state = "ready", children }: { agent: TaskAgent; state?: LogoState; children?: ReactNode }) {
  return (
    <div className="chat-identity">
      <div className="chat-brand">
        <AgentLogo agent={agent} size="lg" state={state} />
        <div className="min-w-0">
          <p className="chat-wordmark" translate="no">{AGENT_LABELS[agent]}</p>
          <p className="chat-location">{AGENT_META[agent].hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function ChatSignature({ agent }: { agent: TaskAgent }) {
  return (
    <div className="chat-signature">
      <span className="flex min-w-0 items-center gap-2" translate="no">
        <AgentLogo agent={agent} size="xs" />
        <span className="chat-signature-name">{AGENT_LABELS[agent]}</span>
      </span>
      <span className="text-[11px] text-faint">Ctrl / ⌘ + Enter to send</span>
    </div>
  );
}
