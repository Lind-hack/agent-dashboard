import { ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, SectionTitle, StatusPill } from "@/components/kit";
import { MailAccounts } from "@/components/mail-accounts";
import { outlookClientId, publicAccounts } from "@/lib/accounts";
import { listRepos } from "@/lib/github";
import { primaryEmail } from "@/lib/gmail";
import { readSkillsStatus, skillsFor } from "@/lib/skills";
import { readHeartbeat } from "@/lib/store";
import { ago } from "@/lib/utils";
import { LogoutButton } from "./logout";
import { SkillFromGithub } from "./skill-from-github";

export const dynamic = "force-dynamic";

// What is connected, read from the environment — values never leave the server.
const CONNECTIONS = [
  { label: "Linear", env: "LINEAR_API_KEY", what: "Issues → agents", how: "Personal API key in /etc/agent-dashboard.env" },
  { label: "GitHub (write)", env: "GITHUB_TOKEN", what: "Branches + PRs", how: "Fine-grained token for the repos below" },
  { label: "GitHub (read)", env: "GITHUB_READ_TOKEN", what: "Brain: commits, PRs", how: "Read-only token for all repos" },
  { label: "Groq", env: "GROQ_API_KEY", what: "Voice, drafting, judge", how: "Free tier key" },
  { label: "NVIDIA Nemotron", env: "NVIDIA_API_KEY", what: "Dossiers, brain, Hermes", how: "Free key from build.nvidia.com" },
  { label: "PC hand-off", env: "HANDOFF_TOKEN", what: "/handoff, brain uploads", how: "~/.agent-dashboard/handoff.env on the PC" },
  { label: "Obsidian vault", env: "MEMORY_VAULT_DIR", what: "Memory + brain", how: "Run deploy/vault-access.sh on the VPS" },
  { label: "Codex CLI", env: "CODEX_BIN", what: "Codex on the VPS", how: "Installed for the agent user" },
];

export default async function SettingsPage() {
  const repos = await listRepos().catch(() => []);
  const hb = readHeartbeat();
  const alive = !!hb.at && Date.now() - new Date(hb.at).getTime() < 60_000;
  const connected = CONNECTIONS.filter((c) => !!process.env[c.env]).length;
  const skills = readSkillsStatus();
  const pcAt = [skills.claude?.at, skills.codex?.at, skills.manifestAt].filter(Boolean).sort().pop();
  const gh = skills.github;
  const fromGithub = Object.entries(skills.fromGithub ?? {});

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Settings"
        sub="What the OS is connected to, and what agents may touch."
        readout={[/^[0-9a-f]{7,40}$/.test(process.env.COMMIT_SHA ?? "") && `build ${process.env.COMMIT_SHA!.slice(0, 7)}`, `${connected}/${CONNECTIONS.length} connected`, alive ? "runner online" : "runner offline"]}
      />

      <SectionTitle right="mail + calendar, merged into the Inbox and Today">Email accounts</SectionTitle>
      <div className="mb-8">
        <MailAccounts initial={publicAccounts()} outlookReady={!!outlookClientId()} mainEmail={await primaryEmail()} />
      </div>

      <SectionTitle>System</SectionTitle>
      <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Panel className="flex min-h-[72px] items-center gap-3 !rounded-[14px] px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Runner</span>
            <span className="block truncate font-mono text-[11px] text-faint">{alive ? `heartbeat ${ago(hb.at)}` : `last seen ${ago(hb.at)}`}</span>
          </span>
          <StatusPill tone={alive ? "ok" : "bad"} pulse={alive}>
            {alive ? "Online" : "Offline"}
          </StatusPill>
        </Panel>
        {CONNECTIONS.map((c) => {
          const on = !!process.env[c.env];
          return (
            <Panel key={c.env} className="flex min-h-[72px] items-center gap-3 !rounded-[14px] px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{c.label}</span>
                <span className="block truncate font-mono text-[11px] text-faint" title={on ? c.what : c.how}>
                  {on ? c.what : c.how}
                </span>
              </span>
              <StatusPill tone={on ? "ok" : "warn"}>{on ? "Connected" : "Not set"}</StatusPill>
            </Panel>
          );
        })}
      </div>

      <SectionTitle right="AGENT_REPOS + token access">Repos agents can work on</SectionTitle>
      <Panel className="mb-8 overflow-hidden">
        {repos.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted">The GitHub token can&apos;t see any repos yet.</p>
        ) : (
          repos.map((r) => (
            <a
              key={r.name}
              href={`https://github.com/${r.name}`}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-14 items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/[0.025]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]" translate="no">
                {r.name}
              </span>
              <span className="font-mono text-[11px] text-faint">{r.base}</span>
              <ArrowUpRight className="h-4 w-4 text-faint transition-colors group-hover:text-text" aria-hidden />
            </a>
          ))
        )}
      </Panel>

      <SectionTitle right="stays on the VPS when the PC is off">Skills</SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(
          [
            ["Claude", String(skillsFor("claude").length)],
            ["Codex", String(skillsFor("codex").length)],
            ["PC sync", pcAt ? ago(pcAt) : "never"],
          ] as const
        ).map(([label, value]) => (
          <Panel key={label} className="flex min-h-[64px] flex-col justify-center !rounded-[14px] px-4 py-3 last:col-span-2 sm:last:col-span-1">
            <span className="hud-label !text-[9.5px]">{label}</span>
            <span className="font-mono text-[15px] tabular-nums">{value}</span>
          </Panel>
        ))}
      </div>
      <Panel className="mb-8 flex flex-col gap-3 px-4 py-4">
        <p className="text-sm text-muted">
          Your PC sends its skills on its own every 2 hours while it&apos;s on. To add one without the PC, paste a GitHub link to a skill folder — or a repo full of them.
        </p>
        <SkillFromGithub />
        {gh?.at && (
          <p className="font-mono text-[11px] break-all text-faint" role="status">
            {gh.error ? (
              <span className="text-bad">✗ {gh.error}</span>
            ) : (
              <>
                {[gh.installed?.length && `installed ${gh.installed.join(", ")}`, gh.unchanged?.length && `${gh.unchanged.length} already current`, gh.skipped?.length && `skipped ${gh.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}`]
                  .filter(Boolean)
                  .join(" · ") || "nothing to install"}
              </>
            )}{" "}
            · {ago(gh.at)}
          </p>
        )}
        {fromGithub.length > 0 && (
          <ul className="flex flex-col border-t border-line pt-2">
            {fromGithub.map(([name, s]) => (
              <li key={name} className="flex min-h-9 items-center gap-3 text-[13px]">
                <span className="font-mono text-command">/{name}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint hover:text-text">
                  {s.url?.replace(/^https:\/\/(www\.)?github\.com\//, "")}
                </a>
                <span className="font-mono text-[11px] text-faint">{s.commit?.slice(0, 7)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SectionTitle>Keyboard</SectionTitle>
      <Panel className="mb-8 flex flex-col gap-2 px-4 py-4 text-sm text-muted">
        <p className="flex items-center justify-between gap-3">
          Search, jump anywhere, start a roast or ask memory
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-text">⌘&nbsp;K / Ctrl&nbsp;K</kbd>
        </p>
        <p className="flex items-center justify-between gap-3">
          Send a message
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-text">⌘&nbsp;↵ / Ctrl&nbsp;↵</kbd>
        </p>
      </Panel>

      <LogoutButton />
    </div>
  );
}
