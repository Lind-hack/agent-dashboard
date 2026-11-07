import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_LABELS, type AgentKey } from "./agents";
import { isSeat, SEAT_PREFIX, seatByKey, seatKey } from "./council";
import { claudeModel, codexModel } from "./config";
import { DEFAULT_MODELS, modelFor, PROVIDER_LABEL, PROVIDERS, providerOrder, type Provider } from "./llm";

// Gemini calls go through lib/gemini.ts, which uses the server's Gemini model, not a per-account pick.
const calledModel = (p: Provider) => (p === "gemini" ? DEFAULT_MODELS.gemini : modelFor(p));
import { solLabel } from "./sol";
import { dataDir, isOwner } from "./tenant";

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
  providers?: Provider[]; // accounts other than the owner: one debater per AI key they brought ("ai:<provider>")
  context?: string; // notes pasted with the task, the evidence when there's no repo
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

// Everyone at the table: agents by key, AI providers as "ai:<provider>", council seats as "seat:<key>".
export const AI_PREFIX = "ai:";
export const isAi = (d: string) => d.startsWith(AI_PREFIX);
export const aiProvider = (d: string) => d.slice(AI_PREFIX.length) as Provider;
export const debaters = (r: Pick<Room, "agents" | "seats" | "providers">): string[] => [
  ...(r.agents ?? []),
  ...(r.providers ?? []).map((p) => `${AI_PREFIX}${p}`),
  ...(r.seats ?? []).map((k) => `${SEAT_PREFIX}${k}`),
];
export const debaterLabel = (d: string) =>
  isSeat(d) ? (seatByKey(seatKey(d))?.name ?? seatKey(d)) : isAi(d) ? (PROVIDER_LABEL[aiProvider(d)] ?? aiProvider(d)) : (AGENT_LABELS[d as AgentKey] ?? d);

export const ROOMS_DIR = () => path.join(dataDir(), "rooms");
export const MAX_ROUNDS = 3;
export const ROOMS_PER_DAY = 5;
export const ROOM_ID_RE = /^R-[A-Z0-9]{6,16}$/;

// Collision-free even for two rooms asked for in the same millisecond.
export const newRoomId = () => `R-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0")}`;

export function readRoom(id: string): Room | null {
  if (!ROOM_ID_RE.test(id)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR(), `${id}.json`), "utf8")) as Room;
    return {
      ...r,
      rounds: r?.rounds ?? [],
      agents: r?.agents ?? [],
      seats: Array.isArray(r?.seats) ? r.seats : [],
      providers: Array.isArray(r?.providers) ? r.providers.filter((p) => PROVIDERS.includes(p)) : [],
      models: r?.models ?? {},
      budget: r?.budget ?? { calls: 0, used: 0 },
    };
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

export const judgeModelName = () => {
  if (isOwner()) return `${solLabel()} (fallback: Nemotron, Groq)`;
  const order = providerOrder();
  return order.length ? `${PROVIDER_LABEL[order[0]]} ${calledModel(order[0])}${order.length > 1 ? ` (fallback: ${order.slice(1).map((p) => PROVIDER_LABEL[p]).join(", ")})` : ""}` : "your AI";
};

export type RoomSpec = { id: string; task: string; repo?: string; agents: AgentKey[]; seats?: string[]; providers?: Provider[]; context?: string };

// A new room as the runner (owner, through the inbox) or the web app (other accounts) first writes it.
export function newRoom(spec: RoomSpec): Room {
  const owner = isOwner();
  const models = owner ? agentModels() : null;
  const now = new Date().toISOString();
  const seatKeys = (spec.seats ?? []).filter((k) => !!seatByKey(k)).slice(0, 6);
  const providers = owner ? [] : [...new Set(spec.providers ?? [])].filter((p) => providerOrder().includes(p));
  const agents = owner ? spec.agents : [];
  const k = agents.length + providers.length + seatKeys.length;
  const seatModel = models ? `${models.hermes.split("/").pop()} · persona + brain` : `${judgeModelName().split(" (")[0]} · persona + brain`;
  return {
    id: spec.id,
    task: spec.task,
    repo: owner ? spec.repo : undefined,
    agents,
    seats: seatKeys,
    providers,
    context: spec.context?.trim().slice(0, 30_000) || undefined,
    models: {
      ...Object.fromEntries(agents.map((a) => [a, a === "hermes" ? `${models!.hermes} · no tools in debates` : models![a]])),
      ...Object.fromEntries(providers.map((p) => [`${AI_PREFIX}${p}`, calledModel(p)])),
      ...Object.fromEntries(seatKeys.map((s) => [`${SEAT_PREFIX}${s}`, seatModel])),
    },
    judgeModel: judgeModelName(),
    status: "queued",
    rounds: [],
    // R43: every debater call, one JSON repair per answer, up to three judge providers per round and for the verdict.
    budget: { calls: k * MAX_ROUNDS * 2 + MAX_ROUNDS * 3 + 3, used: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

// Stopping a room the web app can't reach through the runner inbox (other accounts): a marker the runner reads.
const cancelFile = (id: string) => path.join(ROOMS_DIR(), `${id}.cancel`);
export function requestCancel(id: string) {
  if (!ROOM_ID_RE.test(id)) return;
  fs.mkdirSync(ROOMS_DIR(), { recursive: true });
  fs.writeFileSync(cancelFile(id), "");
}
export function takeCancelRequest(id: string): boolean {
  try {
    fs.rmSync(cancelFile(id));
    return true;
  } catch {
    return false;
  }
}

export function roomsStartedToday(rooms: Room[]): number {
  const day = new Date().toISOString().slice(0, 10);
  return rooms.filter((r) => r.startedAt?.startsWith(day)).length;
}
