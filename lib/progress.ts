// Where an agent is in a task (pure — tested in deploy/progress.test.ts). Agents are briefed to print
//   PLAN:            then a numbered checklist (3–7 lines)
//   STEP n/N: name   before each step
//   DONE n           after it
// When an agent doesn't, the phase is read from its latest tool calls instead. Only the current turn
// counts (everything after the last "turn" event).

export type LogLike = { kind?: string; text?: string; t?: string };
export type Step = { n: number; title: string; status: "done" | "active" | "todo"; startedAt?: string };
export type Progress = { steps: Step[]; current: number | null; total: number | null; phase: string | null; files: string[]; commands: number; startedAt?: string };

const PHASES: [RegExp, string][] = [
  [/\b(railway|vercel|deploy|update\.sh|systemctl restart)\b/i, "Deploying"],
  [/\bgh pr (create|merge)|\bgit push\b/i, "Opening the pull request"],
  [/\bgit (commit|add)\b/i, "Committing"],
  [/\b(tsc|typecheck|lint|eslint|test|vitest|jest|pytest|node --test|next build|npm run build)\b/i, "Running checks"],
];

function phaseOf(tool: string): string | null {
  const t = tool.trim();
  if (/^(bash|shell|exec|run)\b/i.test(t)) return PHASES.find(([re]) => re.test(t))?.[1] ?? "Running commands";
  if (/^(edit|write|multiedit|apply_patch|create|update|delete|notebookedit)\b/i.test(t)) return "Editing files";
  if (/^(read|view|cat|ls|grep|glob|search|find|toolsearch)\b/i.test(t)) return "Exploring the code";
  if (/^(web|websearch|webfetch|fetch)/i.test(t)) return "Researching on the web";
  return null;
}

const fileOf = (tool: string) => tool.trim().match(/^(?:edit|write|multiedit|create|update|notebookedit)\s+(\S+)/i)?.[1];

export function parseProgress(log: LogLike[]): Progress {
  let from = 0;
  for (let i = log.length - 1; i >= 0; i--)
    if (log[i].kind === "turn") {
      from = i + 1;
      break;
    }
  const turn = log.slice(from);
  const steps = new Map<number, Step>();
  let total: number | null = null;
  let current: number | null = null;
  const done = new Set<number>();
  const files: string[] = [];
  let commands = 0;
  let phase: string | null = null;

  for (const e of turn) {
    const text = e.text ?? "";
    if (e.kind === "tool") {
      const f = fileOf(text);
      if (f && !files.includes(f)) files.push(f);
      if (/^(bash|shell|exec|run)\b/i.test(text.trim())) commands++;
      phase = phaseOf(text) ?? phase;
      continue;
    }
    if (e.kind !== "text" && e.kind !== "result") continue;
    const plan = text.match(/(?:^|\n)\s*PLAN:\s*\n([\s\S]*?)(?:\n\s*\n|$)/i);
    if (plan) {
      for (const line of plan[1].split("\n")) {
        const m = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
        if (m && Number(m[1]) <= 12) steps.set(Number(m[1]), { n: Number(m[1]), title: m[2].trim().slice(0, 140), status: "todo" });
      }
      if (steps.size) total = Math.max(...steps.keys());
    }
    for (const m of text.matchAll(/(?:^|\n)\s*STEP\s+(\d+)\s*\/\s*(\d+)\s*:\s*(.+)/gi)) {
      const n = Number(m[1]);
      total = Number(m[2]) || total;
      current = n;
      const old = steps.get(n);
      steps.set(n, { n, title: old?.title ?? m[3].trim().slice(0, 140), status: "todo", startedAt: e.t });
    }
    for (const m of text.matchAll(/(?:^|\n)\s*DONE\s+(\d+)\b/gi)) done.add(Number(m[1]));
  }

  const list = [...steps.values()].sort((a, z) => a.n - z.n).map((s) => ({
    ...s,
    status: (done.has(s.n) || (current !== null && s.n < current) ? "done" : s.n === current ? "active" : "todo") as Step["status"],
  }));
  return { steps: list, current, total, phase, files, commands, startedAt: turn[0]?.t };
}
