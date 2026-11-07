import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentTenant, dataDir, vaultDir, type Tenant } from "./tenant";
import { findUser, tenantOf } from "./users";

// Two-way sync between an account's Obsidian vault and its copy on the server (tenants/<id>/vault), which the
// journal, goals, Buddy and Memory read and write. The Obsidian plugin (public/obsidian) keeps the last state
// both sides agreed on and decides per file what to push, pull or keep as a conflict copy; the server only
// lists, reads, writes and deletes, and refuses a write whose base hash is stale (the plugin then resolves it).
// Authentication is a per-account sync code ("adv_<user>_<secret>"), stored hashed; one per device, up to five
// (the oldest goes when a sixth is made). Unpairing removes them all.

export const MAX_FILE = 2 * 1024 * 1024;
export const MAX_VAULT = 200 * 1024 * 1024;
const EXT = /\.(md|canvas)$/i;

const tokenFile = () => path.join(dataDir(), "vault-sync.json");
type TokenRecord = { codes: { hash: string; createdAt: string }[]; lastSyncAt?: string };
const MAX_CODES = 5;

const sha = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

function readToken(t?: Tenant): TokenRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(path.join((t ?? currentTenant()).dir, "vault-sync.json"), "utf8"));
    return Array.isArray(r?.codes) && r.codes.length ? r : null;
  } catch {
    return null;
  }
}

export function syncStatus(): { paired: boolean; devices: number; lastSyncAt?: string } {
  const r = readToken();
  return r ? { paired: true, devices: r.codes.length, lastSyncAt: r.lastSyncAt } : { paired: false, devices: 0 };
}

export function newSyncCode(): string {
  const t = currentTenant();
  if (t.owner) throw new Error("The owner's vault syncs with Syncthing");
  const code = `adv_${t.id}_${crypto.randomBytes(24).toString("base64url")}`;
  fs.mkdirSync(dataDir(), { recursive: true });
  const prev = readToken();
  const rec: TokenRecord = { codes: [...(prev?.codes ?? []), { hash: sha(code), createdAt: new Date().toISOString() }].slice(-MAX_CODES), lastSyncAt: prev?.lastSyncAt };
  fs.writeFileSync(tokenFile(), JSON.stringify(rec), { mode: 0o600 });
  fs.mkdirSync(vaultDir(), { recursive: true });
  return code;
}

export function revokeSyncCode() {
  fs.rmSync(tokenFile(), { force: true });
}

export function tenantFromSyncCode(code: string): Tenant | null {
  const m = /^adv_(u_[0-9a-f]{16})_([\w-]{20,})$/.exec(code);
  if (!m) return null;
  const u = findUser(m[1]);
  if (!u || u.disabled) return null;
  const t = tenantOf(u);
  const rec = readToken(t);
  if (!rec) return null;
  const a = Buffer.from(sha(code), "hex");
  const hit = rec.codes.some((c) => {
    const b = Buffer.from(String(c?.hash ?? ""), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  return hit ? t : null;
}

export function markSynced() {
  const r = readToken();
  if (!r) return;
  r.lastSyncAt = new Date().toISOString();
  fs.writeFileSync(tokenFile(), JSON.stringify(r), { mode: 0o600 });
}

export class VaultPathError extends Error {}

// A vault-relative path the plugin may touch: notes and canvases, never Obsidian's own config or hidden folders.
export function safePath(rel: string): string {
  const p = String(rel ?? "").normalize("NFC");
  if (!p || p.length > 400 || p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[a-z]:/i.test(p)) throw new VaultPathError("Bad path");
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) throw new VaultPathError("Bad path");
  if (!EXT.test(p)) throw new VaultPathError("Only .md and .canvas files sync");
  const full = path.resolve(vaultDir(), p);
  if (!full.startsWith(path.resolve(vaultDir()) + path.sep)) throw new VaultPathError("Bad path");
  return full;
}

export type ManifestEntry = { path: string; hash: string; size: number; mtime: number };

export function manifest(): ManifestEntry[] {
  const root = vaultDir();
  const out: ManifestEntry[] = [];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, r);
      else if (e.isFile() && EXT.test(e.name)) {
        const buf = fs.readFileSync(full);
        out.push({ path: r.normalize("NFC"), hash: sha(buf), size: buf.length, mtime: Math.round(fs.statSync(full).mtimeMs) });
      }
    }
  };
  walk(root, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function hashOf(rel: string): string | null {
  try {
    return sha(fs.readFileSync(safePath(rel)));
  } catch (e) {
    if (e instanceof VaultPathError) throw e;
    return null;
  }
}

export function readNote(rel: string): Buffer | null {
  try {
    return fs.readFileSync(safePath(rel));
  } catch (e) {
    if (e instanceof VaultPathError) throw e;
    return null;
  }
}

export type WriteResult = { ok: true; hash: string } | { ok: false; status: number; error: string; hash?: string | null };

// `base` is the hash the plugin last saw on the server ("" = it believes the file doesn't exist). A different
// current hash means the server copy changed meanwhile: the write is refused so nothing is lost.
export function writeNote(rel: string, body: Buffer, base: string | null): WriteResult {
  const full = safePath(rel);
  if (body.length > MAX_FILE) return { ok: false, status: 413, error: "That note is over 2 MB" };
  const current = hashOf(rel);
  if (base !== null && (current ?? "") !== base) return { ok: false, status: 409, error: "Changed on the server", hash: current };
  const total = manifest().reduce((s, m) => s + m.size, 0) - (current ? (fs.statSync(full).size ?? 0) : 0) + body.length;
  if (total > MAX_VAULT) return { ok: false, status: 413, error: "The vault is over 200 MB on the server" };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.sync-tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, full);
  return { ok: true, hash: sha(body) };
}

export function deleteNote(rel: string, base: string | null): WriteResult {
  const full = safePath(rel);
  const current = hashOf(rel);
  if (!current) return { ok: true, hash: "" };
  if (base !== null && current !== base) return { ok: false, status: 409, error: "Changed on the server", hash: current };
  fs.rmSync(full, { force: true });
  // Leave no empty folders behind, up to the vault root.
  const root = path.resolve(vaultDir());
  for (let d = path.dirname(full); d.startsWith(root + path.sep); d = path.dirname(d)) {
    try {
      fs.rmdirSync(d);
    } catch {
      break;
    }
  }
  return { ok: true, hash: "" };
}
