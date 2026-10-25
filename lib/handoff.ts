import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { DATA_DIR } from "./config";

// Hand-off v2 storage. The PC script uploads a chat's raw transcript (needed verbatim to resume it)
// and a context bundle (redacted condensed chats, memory notes, CLAUDE.md/rules, skills) in chunks;
// `finish` verifies and publishes them as handoffs/sessions/<sessionId>/<generation>/, which the
// runner turns into a job. Nothing the client sends is ever used as a filesystem path.

export const HANDOFF_DIR = () => path.join(DATA_DIR, "handoffs");
const uploadsDir = () => path.join(HANDOFF_DIR(), "uploads");
export const sessionsDir = () => path.join(HANDOFF_DIR(), "sessions");
const reservationsDir = () => path.join(HANDOFF_DIR(), "reservations");

export const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GEN_RE = /^\d{13}$/; // ms timestamp
const UPLOAD_RE = /^u[0-9a-f]{24}$/;
const PARTS = ["transcript", "context"] as const;
type Part = (typeof PARTS)[number];

export const LIMITS = {
  chunkBytes: 40 * 1024 * 1024, // under Cloudflare's 100 MB body cap
  maxChunks: 30,
  stagedBytes: 1.2 * 1024 ** 3,
  unpackedBytes: { transcript: 1024 ** 3, context: 200 * 1024 * 1024 } as Record<Part, number>,
  expiryMs: 24 * 3600_000,
};

export type HandoffMeta = {
  agent: "claude" | "codex";
  sessionId: string;
  generation: string;
  title: string;
  mode: "native" | "summary";
  pc: { transcriptPath: string; transcriptSha256: string; cwd: string; projectDir: string; cliVersion?: string; transcriptFile?: string };
  repo?: string; // owner/name, absent = conversation-only
  snapshot?: { ref: string; sha: string; pcBranch?: string; boundary: string };
};

const dirOf = (sid: string, gen: string) => path.join(sessionsDir(), sid, gen);
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function cleanupExpired() {
  for (const u of safeList(uploadsDir())) {
    const meta = readJSON<{ startedAt?: number }>(path.join(uploadsDir(), u, "meta.json"));
    if (!meta?.startedAt || Date.now() - meta.startedAt > LIMITS.expiryMs) fs.rmSync(path.join(uploadsDir(), u), { recursive: true, force: true });
  }
}

const safeList = (d: string) => {
  try {
    return fs.readdirSync(d);
  } catch {
    return [];
  }
};

export function readJSON<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// A session can have one open hand-off at a time (released when the job closes or the PC takes it back).
export function reservation(sid: string): { generation: string; at: string } | null {
  return readJSON(path.join(reservationsDir(), `${sid}.json`));
}

export function releaseReservation(sid: string, generation: string) {
  const r = reservation(sid);
  if (r?.generation === generation) fs.rmSync(path.join(reservationsDir(), `${sid}.json`), { force: true });
}

export function validateMeta(m: Partial<HandoffMeta> | null, allowedRepos: string[]): string | null {
  if (!m) return "missing metadata";
  if (m.agent !== "claude" && m.agent !== "codex") return "agent must be claude or codex";
  if (!SID_RE.test(m.sessionId ?? "")) return "bad sessionId";
  if (!GEN_RE.test(m.generation ?? "")) return "bad generation";
  if (m.mode !== "native" && m.mode !== "summary") return "bad mode";
  if (typeof m.title !== "string" || !m.pc || !/^[0-9a-f]{64}$/.test(m.pc.transcriptSha256 ?? "")) return "bad pc info";
  if (m.repo && !allowedRepos.includes(m.repo)) return `repo ${m.repo} is not on the dashboard's write token (AGENT_REPOS)`;
  if (m.repo && (!m.snapshot || !/^[0-9a-f]{40}$/.test(m.snapshot.sha) || !m.snapshot.ref.startsWith(`refs/agent-handoff/${m.sessionId}/`))) return "bad snapshot";
  return null;
}

export function startUpload(meta: HandoffMeta): { uploadId: string } | { error: string; status: number } {
  cleanupExpired();
  if (safeList(uploadsDir()).length) return { error: "Another hand-off upload is in progress — try again in a minute.", status: 409 };
  fs.mkdirSync(reservationsDir(), { recursive: true });
  const resFile = path.join(reservationsDir(), `${meta.sessionId}.json`);
  try {
    // O_EXCL: two uploads of the same chat can't both pass this.
    fs.writeFileSync(resFile, JSON.stringify({ generation: meta.generation, at: new Date().toISOString() }), { flag: "wx" });
  } catch {
    const r = reservation(meta.sessionId);
    return { error: `This chat is already on the VPS (hand-off ${r?.generation ?? "?"}). Bring it back or archive it first.`, status: 409 };
  }
  const uploadId = `u${crypto.randomBytes(12).toString("hex")}`;
  fs.mkdirSync(path.join(uploadsDir(), uploadId), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir(), uploadId, "meta.json"), JSON.stringify({ ...meta, startedAt: Date.now() }));
  return { uploadId };
}

export function putChunk(uploadId: string, part: string, index: number, body: Buffer, claimedSha: string): string | null {
  if (!UPLOAD_RE.test(uploadId)) return "bad upload id";
  if (!PARTS.includes(part as Part)) return "bad part";
  if (!Number.isInteger(index) || index < 0 || index >= LIMITS.maxChunks) return "bad chunk index";
  if (body.length > LIMITS.chunkBytes) return "chunk too large";
  if (sha256(body) !== claimedSha) return "chunk hash mismatch";
  const dir = path.join(uploadsDir(), uploadId);
  if (!fs.existsSync(path.join(dir, "meta.json"))) return "unknown or expired upload";
  const staged = safeList(dir).filter((f) => f.endsWith(".gz")).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  if (staged + body.length > LIMITS.stagedBytes) return "upload too large";
  fs.writeFileSync(path.join(dir, `${part}.${String(index).padStart(3, "0")}.gz`), body); // same index again = idempotent overwrite
  return null;
}

// Concatenated gzip chunks → one file, with a byte cap enforced while streaming.
async function unpack(dir: string, part: Part, chunks: number, out: string): Promise<string> {
  const files = Array.from({ length: chunks }, (_, i) => path.join(dir, `${part}.${String(i).padStart(3, "0")}.gz`));
  for (const f of files) if (!fs.existsSync(f)) throw new Error(`missing ${part} chunk ${path.basename(f)}`);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > LIMITS.unpackedBytes[part]) return cb(new Error(`${part} is too large`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  const source = (async function* () {
    for (const f of files) yield fs.readFileSync(f);
  })();
  await pipeline(source, createGunzip(), cap, fs.createWriteStream(out));
  return hash.digest("hex");
}

export async function finishUpload(
  uploadId: string,
  parts: Record<Part, { chunks: number; sha256: string }>,
): Promise<{ sessionId: string; generation: string } | { error: string; status: number }> {
  if (!UPLOAD_RE.test(uploadId)) return { error: "bad upload id", status: 400 };
  const dir = path.join(uploadsDir(), uploadId);
  const meta = readJSON<HandoffMeta & { startedAt: number }>(path.join(dir, "meta.json"));
  if (!meta) return { error: "unknown or expired upload", status: 404 };
  const final = dirOf(meta.sessionId, meta.generation);
  const staging = `${final}.staging`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    for (const part of PARTS) {
      const p = parts?.[part];
      if (!p || !Number.isInteger(p.chunks) || p.chunks < 1 || p.chunks > LIMITS.maxChunks) throw new Error(`bad ${part} chunk count`);
      const out = path.join(staging, part === "transcript" ? "transcript.jsonl" : "context.json");
      const got = await unpack(dir, part, p.chunks, out);
      if (got !== p.sha256) throw new Error(`${part} hash mismatch`);
    }
    const { startedAt: _s, ...clean } = meta;
    fs.writeFileSync(path.join(staging, "meta.json"), JSON.stringify({ ...clean, uploadedAt: new Date().toISOString() }, null, 2));
    fs.mkdirSync(path.dirname(final), { recursive: true });
    fs.renameSync(staging, final); // published: the runner picks it up from here (durable outbox)
    fs.rmSync(dir, { recursive: true, force: true });
    return { sessionId: meta.sessionId, generation: meta.generation };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    return { error: err instanceof Error ? err.message : String(err), status: 400 };
  }
}

// Abandoning an upload (PC script failed midway) frees the chat for another try.
export function abortUpload(uploadId: string) {
  if (!UPLOAD_RE.test(uploadId)) return;
  const meta = readJSON<HandoffMeta>(path.join(uploadsDir(), uploadId, "meta.json"));
  fs.rmSync(path.join(uploadsDir(), uploadId), { recursive: true, force: true });
  if (meta && !fs.existsSync(dirOf(meta.sessionId, meta.generation))) releaseReservation(meta.sessionId, meta.generation);
}

export const jobIdFor = (generation: string) => `H-${Number(generation).toString(36).toUpperCase()}`;

// Published hand-offs the runner hasn't imported yet.
export function pendingImports(): { dir: string; meta: HandoffMeta }[] {
  const out: { dir: string; meta: HandoffMeta }[] = [];
  for (const sid of safeList(sessionsDir())) {
    if (!SID_RE.test(sid)) continue;
    for (const gen of safeList(path.join(sessionsDir(), sid))) {
      if (!GEN_RE.test(gen)) continue;
      const dir = dirOf(sid, gen);
      if (fs.existsSync(path.join(dir, "imported.json"))) continue;
      const meta = readJSON<HandoffMeta>(path.join(dir, "meta.json"));
      if (meta) out.push({ dir, meta });
    }
  }
  return out;
}

export const handoffDir = (sid: string, gen: string) => (SID_RE.test(sid) && GEN_RE.test(gen) ? dirOf(sid, gen) : null);
