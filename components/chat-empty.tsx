import { AgentLogo } from "@/components/agent-logo";
import { AGENT_LABELS, AGENT_PERSONA, type TaskAgent } from "@/lib/agents";

export function ChatEmpty({ agent }: { agent: TaskAgent }) {
  return (
    <section className="chat-empty flex flex-col items-center px-4 py-14 text-center">
      <AgentLogo agent={agent} size="lg" />
      <h2 className="mt-5 text-2xl font-medium tracking-tight text-balance">
        {agent === "claude" ? "What are we working on?" : `Build with ${AGENT_LABELS[agent]}`}
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{AGENT_PERSONA[agent].idle}</p>
    </section>
  );
}
