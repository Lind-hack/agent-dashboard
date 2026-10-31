import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_LABELS, type AgentKey } from "./agents";
import { isSeat, SEAT_PREFIX, seatByKey, seatKey } from "./council";
import { claudeModel, codexModel, DATA_DIR } from "./config";
import { solLabel } from "./sol";

// Roast rooms (PLAN-v2 stage 2): several agents debate one task until a neutral judge finds consensus.
// One JSON file per room under data/rooms/, written only by the runner (runner/room.ts); the web app
// reads them and asks for changes through the inbox.

export type DebaterJSON = {
  position?: string;
  confidence?: number;
  agrees_with?: string[];
  weakest_claims?: { agent?: string; claim?: string; why?: string }[];
  evidence?: { kind?: string; ref?: string }[];
};

export type RoomAnswer = {
  status: "waiting" | "running" | "done" | "failed";
  text?: string;
  json?: DebaterJSON | null; // null = the agent gave no structured answer (after one repair try)
  startedAt?: string;
  endedAt?: string;
  error?: string;
};

export type JudgeRound = {
  agreement: number; // 0–100
  open_disagreements: { topic: string; sides?: string; blocking?: boolean }[];
  per_agent: { agent: string; stance: string; changed?: boolean; why?: string }[];
  unverified_claims: { agent: string; claim: string }[];
  // v4: the judge's rubric per debater, 0–10 each (total = sum, 0–40).
  scores?: { agent: string; evidence: number; reasoning: number; practicality: number; responsiveness: number; total: number; note?: string }[];
  model: string;
};

export type Verdict = {
  outcome: "consensus" | "split" | "incomplete" | "no-verdict";
  recommendation: string; // markdown
  support: Record<string, number>; // agent → % support for the recommendation
  positions: { agent: string; final: string }[];
  dissent: string[];
  next_step: string;
  best_agent?: string;
  model: string;
  // v4 decision memo (older rooms don't have it).
  decision?: string; // one line: what to do
  why?: string; // markdown
  objection?: { claim: string; answer: string }; // the strongest objection, and how it's answered
  risks?: string[];
  actions?: { title: string; who: "lind" | "agent" }[]; // ≤3, each one tap: an agent chat or a block on today's plan
  confidence?: number; // 0–100
  scoreboard?: { agent: string; score: number }[]; // rubric totals across rounds, best first
  winner?: string;
};

export type RoomRound = { n: number; answers: Partial<Record<string, RoomAnswer>>; judge?: JudgeRound | null; judgeError?: string };

export type Room = {
  id: string;
  task: string;
  repo?: string;
  agents: AgentKey[];
  seats?: string[]; // council seat keys debating alongside (or instead of) the agents
  models: Partial<Record<string, string>>;
  judgeModel: string;
  status: "queued" | "evidence" | "debating" | "judging" | "done" | "cancelled" | "refused";
  reason?: string; // why refused / cancelled
  evidence?: { files: string[]; bytes: number; note?: string };
  rounds: RoomRound[];
  verdict?: Verdict;
  budget: { calls: number; used: number }; // every model call, reserved before it's made (R43)
  startedAt?: string; // admitted by the runner — the daily limit counts these
  createdAt: string;
  updatedAt: string;
};

// Everyone at the table: agents by key, council seats as "seat:<key>".
export const debaters = (r: Pick<Room, "agents" | "seats">): string[] => [...(r.agents ?? []), ...(r.seats ?? []).map((k) => `${SEAT_PREFIX}${k}`)];
export const debaterLabel = (d: string) => (isSeat(d) ? (seatByKey(seatKey(d))?.name ?? seatKey(d)) : (AGENT_LABELS[d as AgentKey] ?? d));

export const ROOMS_DIR = () => path.join(DATA_DIR, "rooms");
export const MAX_ROUNDS = 3;
export const ROOMS_PER_DAY = 5;
export const ROOM_ID_RE = /^R-[A-Z0-9]{6,16}$/;

// Collision-free even for two rooms asked for in the same millisecond.
export const newRoomId = () => `R-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0")}`;

export function readRoom(id: string): Room | null {
  if (!ROOM_ID_RE.test(id)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR(), `${id}.json`), "utf8")) as Room;
    return { ...r, rounds: r?.rounds ?? [], agents: r?.agents ?? [], seats: Array.isArray(r?.seats) ? r.seats : [], models: r?.models ?? {}, budget: r?.budget ?? { calls: 0, used: 0 } };
  } catch {
    return null;
  }
}

export function listRooms(): Room[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(ROOMS_DIR()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => readRoom(f.slice(0, -5)))
    .filter((r): r is Room => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function writeRoom(room: Room) {
  fs.mkdirSync(ROOMS_DIR(), { recursive: true });
  room.updatedAt = new Date().toISOString();
  const file = path.join(ROOMS_DIR(), `${room.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(room, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

function codexConfiguredModel(): string {
  try {
    const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    return fs.readFileSync(path.join(home, "config.toml"), "utf8").match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  } catch {
    return "";
  }
}

function hermesModel(): string {
  try {
    const conf = fs.readFileSync("/etc/agent-dashboard-hermes.conf", "utf8");
    return conf.match(/^\s*MODEL\s*=\s*"?([^"\s]+)/m)?.[1] ?? conf.match(/^\s*-m\s+(\S+)/m)?.[1] ?? "";
  } catch {
    return "";
  }
}

// The real model behind each agent, so the room can show it and warn when two debaters share one.
export function agentModels(): Record<AgentKey, string> {
  return {
    claude: claudeModel() || "Claude (plan default)",
    codex: codexModel() || codexConfiguredModel() || "Codex (CLI default)",
    opencode: process.env.OPENCODE_MODEL ?? "opencode/deepseek-v4.1-flash-free",
    hermes: hermesModel() || "nvidia/nemotron-3-ultra-550b-a55b",
  };
}

export const judgeModelName = () => `${solLabel()} (fallback: Nemotron, Groq)`;

export function roomsStartedToday(rooms: Room[]): number {
  const day = new Date().toISOString().slice(0, 10);
  return rooms.filter((r) => r.startedAt?.startsWith(day)).length;
}
