import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, type Tenant } from "./tenant";
import { tenantById } from "./users";

// Kuvend (Lind's local workspace for Claude Code and Codex) can put a hard call in front of this account's
// Roast room and read the verdict back. It authenticates with a link code, "kvd_<account>_<secret>",
// stored hashed, one per computer, up to five. A code opens only the Kuvend routes of its own account.

const file = (t?: Tenant) => path.join(t?.dir ?? dataDir(), "kuvend-link.json");
type Record_ = { codes: { hash: string; createdAt: string; usedAt?: string }[] };
const MAX_CODES = 5;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function read(t?: Tenant): Record_ {
  try {
    const r = JSON.parse(fs.readFileSync(file(t), "utf8"));
    return { codes: Array.isArray(r?.codes) ? r.codes.filter((c: { hash?: unknown }) => typeof c?.hash === "string") : [] };
  } catch {
    return { codes: [] };
  }
}

function write(r: Record_, t?: Tenant) {
  const f = file(t);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(r), { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
}

export function linkStatus(): { linked: number; lastUsedAt?: string } {
  const r = read();
  const used = r.codes.map((c) => c.usedAt).filter((x): x is string => !!x).sort();
  return { linked: r.codes.length, lastUsedAt: used.at(-1) };
}

export function newLinkCode(tenant: Tenant): string {
  const code = `kvd_${tenant.id}_${crypto.randomBytes(24).toString("base64url")}`;
  const r = read();
  write({ codes: [...r.codes, { hash: sha(code), createdAt: new Date().toISOString() }].slice(-MAX_CODES) });
  return code;
}

export function revokeLinkCodes() {
  fs.rmSync(file(), { force: true });
}

// The account a code belongs to, or null. A paused account's codes stop working with it.
export function tenantFromLinkCode(code: string): Tenant | null {
  const m = /^kvd_(owner|u_[0-9a-f]{16})_([\w-]{20,})$/.exec(code);
  if (!m) return null;
  const t = tenantById(m[1]);
  if (!t) return null;
  const r = read(t);
  const a = Buffer.from(sha(code), "hex");
  const hit = r.codes.find((c) => {
    const b = Buffer.from(c.hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!hit) return null;
  hit.usedAt = new Date().toISOString();
  write(r, t);
  return t;
}
