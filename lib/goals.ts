import fs from "node:fs";
import path from "node:path";

// Short- and long-term goals live in the Syncthing vault so Lind can edit them in Obsidian and the
// planner reads the same file. One markdown list, one goal per line:
//
//   - [ ] now Ship the 383 subscriber funnel | next: write the landing copy | why: first revenue | due: 2026-11-15
//
// horizon is now / short / long. `next:` is the concrete next action the planner reserves time for,
// `why:` is the reason to keep going, `due:` an optional target date. Ticks are kept on the line.

const vaultDir = () => process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain";

export type GoalHorizon = "now" | "short" | "long";

export type Goal = {
  id: string;
  horizon: GoalHorizon;
  title: string;
  next: string;
  why: string;
  due?: string;
  done: boolean;
};

const HORIZONS: Record<string, GoalHorizon> = {
  now: "now",
  today: "now",
  doing: "now",
  focus: "now",
  short: "short",
  soon: "short",
  "short-term": "short",
  shortterm: "short",
  next: "short",
  long: "long",
  later: "long",
  someday: "long",
  "long-term": "long",
  longterm: "long",
};

export const goalsFile = () => path.join(vaultDir(), "100 - Me", "Goals.md");

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const validDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export function goalSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "goal";
}

const goalId = (title: string) => `goal-${goalSlug(title)}`;

function parseLine(line: string): Goal | null {
  const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
  if (!m) return null;
  const done = m[1].toLowerCase() === "x";
  const body = m[2].trim();
  // Horizon may be bare ("now …"), bracketed ("[now] …") or separated by a dot/dash.
  const head = body.match(/^\[?([A-Za-z-]+)\]?[\s:·.–-]+(.+)$/);
  if (!head) return null;
  const horizon = HORIZONS[head[1].toLowerCase()];
  if (!horizon) return null;
  const parts = head[2]
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  let title = parts.shift() ?? "";
  let next = "";
  let why = "";
  let due: string | undefined;
  for (const part of parts) {
    const kv = part.match(/^(next|why|due|by|target)\s*:\s*(.+)$/i);
    if (!kv) {
      title = [title, part].filter(Boolean).join(" — ");
      continue;
    }
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (key === "next") next = value;
    else if (key === "why") why = value;
    else due = value;
  }
  // Also accept a bare leading target date: "- [ ] now 2026-11-15 Ship the funnel".
  const leading = title.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (leading) {
    due ??= leading[1];
    title = leading[2];
  }
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return null;
  return { id: goalId(title), horizon, title: clip(title), next: clip(next), why: clip(why), due: validDate(due), done };
}

function withUniqueIds(goals: Goal[]): Goal[] {
  const seen = new Map<string, number>();
  return goals.map((g) => {
    const n = (seen.get(g.id) ?? 0) + 1;
    seen.set(g.id, n);
    return n === 1 ? g : { ...g, id: `${g.id}-${n}` };
  });
}

export function readGoals(): Goal[] {
  try {
    const md = fs.readFileSync(goalsFile(), "utf8");
    return withUniqueIds(md.split("\n").map(parseLine).filter((g): g is Goal => g !== null));
  } catch {
    return [];
  }
}

// Active = what the day planner may schedule. Long-horizon goals stay visible on the Goals page but
// never crowd out the three things that matter this week.
export function activeGoals(max = 3): Goal[] {
  return readGoals()
    .filter((g) => !g.done && (g.horizon === "now" || g.horizon === "short"))
    .sort((a, z) => (a.horizon === z.horizon ? 0 : a.horizon === "now" ? -1 : 1))
    .slice(0, max);
}

export function goalById(id: string | undefined): Goal | undefined {
  if (!id) return undefined;
  return readGoals().find((g) => g.id === id);
}

export function writeGoals(goals: Goal[]): boolean {
  const clean = withUniqueIds(
    goals
      .map((g): Goal | null => {
        const title = String(g.title ?? "").replace(/\s+/g, " ").trim();
        return title
          ? {
              id: goalId(title),
              horizon: HORIZONS[String(g.horizon ?? "").toLowerCase()] ?? "short",
              title: clip(title),
              next: clip(String(g.next ?? "").trim()),
              why: clip(String(g.why ?? "").trim()),
              due: validDate(g.due),
              done: !!g.done,
            }
          : null;
      })
      .filter((g): g is Goal => g !== null),
  );
  const md = [
    "---",
    "tags: [me, goals]",
    `modified: ${new Date().toISOString()}`,
    "source: agents.383ks.com",
    "---",
    "",
    "# Goals",
    "",
    ...clean.map(
      (g) =>
        `- [${g.done ? "x" : " "}] ${g.horizon} ${g.title}${g.next ? ` | next: ${g.next}` : ""}${g.why ? ` | why: ${g.why}` : ""}${g.due ? ` | due: ${g.due}` : ""}`,
    ),
    "",
  ].join("\n");
  const file = goalsFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, md);
    fs.renameSync(`${file}.tmp`, file);
    return true;
  } catch {
    return false;
  }
}
