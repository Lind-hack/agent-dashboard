import type { AgentKey } from "./agents";
import { seatByKey } from "./council";
import { PROVIDERS, providerOrder, type Provider } from "./llm";
import { listRooms, newRoom, newRoomId, readRoom, ROOMS_PER_DAY, writeRoom } from "./rooms";
import { pushInbox } from "./store";
import { isOwner } from "./tenant";

// Starting a Roast room, for the Room page and for Kuvend. The owner's rooms go to the runner through its
// inbox (it owns the agents and the repo evidence); other accounts' rooms are written here and picked up
// on the runner's next scan.

export type StartResult = { ok: true; id: string } | { ok: false; status: number; error: string };

export function startRoom(spec: { task: string; agents?: AgentKey[]; repo?: string; providers?: string[]; seats?: string[]; context?: string }): StartResult {
  const seats = [...new Set(spec.seats ?? [])].filter((k) => !!seatByKey(k)).slice(0, 6);
  const id = newRoomId();
  if (isOwner()) {
    const agents = spec.agents ?? [];
    if (agents.length > 4) return { ok: false, status: 400, error: "At most 4 agents" };
    if (agents.length + seats.length < 2 || agents.length + seats.length > 7) return { ok: false, status: 400, error: "Seat 2 to 7 at the table (agents and council seats)" };
    pushInbox({ kind: "room-create", room: { id, task: spec.task, repo: spec.repo, agents, seats, context: spec.context?.slice(0, 30_000) || undefined } });
    return { ok: true, id };
  }
  const have = providerOrder();
  if (!have.length) return { ok: false, status: 400, error: "Add an AI key in Settings first" };
  const providers = [...new Set(spec.providers ?? [])].filter((p): p is Provider => PROVIDERS.includes(p as Provider) && have.includes(p as Provider));
  const n = providers.length + seats.length;
  if (n < 2 || n > 7) return { ok: false, status: 400, error: "Seat 2 to 7 at the table (your AIs and council seats)" };
  const day = new Date().toISOString().slice(0, 10);
  if (listRooms().filter((r) => r.createdAt.startsWith(day)).length >= ROOMS_PER_DAY) return { ok: false, status: 429, error: `That's ${ROOMS_PER_DAY} debates today. Start this one tomorrow.` };
  if (!readRoom(id)) writeRoom(newRoom({ id, task: spec.task, agents: [], providers, seats, context: spec.context?.slice(0, 30_000) }));
  return { ok: true, id };
}

// Kuvend's default table for a code change: the owner's free agents, or an account's own AIs, plus two
// council seats that judge product and execution.
export function kuvendTable(): { agents?: AgentKey[]; providers?: string[]; seats: string[] } {
  const seats = ["graham", "musk"];
  if (isOwner()) return { agents: ["opencode", "hermes"], seats };
  return { providers: providerOrder().slice(0, 3), seats };
}
