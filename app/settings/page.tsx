import { Dot, PageHeader, Panel, SectionTitle } from "@/components/kit";
import { listRepos } from "@/lib/github";
import { readHeartbeat } from "@/lib/store";
import { ago } from "@/lib/utils";
import { LogoutButton } from "./logout";

export const dynamic = "force-dynamic";

// What is connected, read from the environment — values never leave the server.
const CONNECTIONS = [
  { label: "Linear", env: "LINEAR_API_KEY", how: "Personal API key in /etc/agent-dashboard.env" },
  { label: "GitHub", env: "GITHUB_TOKEN", how: "Fine-grained token for the repos below" },
  { label: "Groq (voice + drafting)", env: "GROQ_API_KEY", how: "Free tier key" },
  { label: "Hand-off from the PC", env: "HANDOFF_TOKEN", how: "~/.agent-dashboard/handoff.env on the PC" },
  { label: "Codex CLI", env: "CODEX_BIN", how: "Installed for the agent user" },
];

export default async function SettingsPage() {
  const repos = await listRepos().catch(() => []);
  const hb = readHeartbeat();
  const alive = !!hb.at && Date.now() - new Date(hb.at).getTime() < 60_000;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" sub={`Build ${process.env.COMMIT_SHA ?? "dev"}`} />

      <SectionTitle>Connections</SectionTitle>
      <Panel className="mb-8 overflow-hidden">
        {CONNECTIONS.map((c) => {
          const on = !!process.env[c.env];
          return (
            <div key={c.env} className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              <Dot tone={on ? "ok" : "bad"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{c.label}</span>
                <span className="block text-xs text-muted">{on ? "Connected" : c.how}</span>
              </span>
            </div>
          );
        })}
        <div className="flex min-h-14 items-center gap-3 px-4 py-3">
          <Dot tone={alive ? "ok" : "bad"} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Runner</span>
            <span className="block text-xs text-muted">{alive ? "Online" : `Offline — last seen ${ago(hb.at)}`}</span>
          </span>
        </div>
      </Panel>

      <SectionTitle right="AGENT_REPOS + token access">Repos agents can work on</SectionTitle>
      <Panel className="mb-8 overflow-hidden">
        {repos.map((r) => (
          <a key={r.name} href={`https://github.com/${r.name}`} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.02]">
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.name}</span>
            <span className="text-xs text-muted">{r.base}</span>
          </a>
        ))}
      </Panel>

      <LogoutButton />
    </div>
  );
}
