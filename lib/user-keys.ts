import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { currentTenant, dataDir } from "./tenant";

// AI and service keys. The owner's come from /etc/agent-dashboard.env as before. Everyone else brings
// their own, stored encrypted in their data folder, and never borrows the owner's: a missing key means
// that feature is off for them, not that it runs on Lind's quota.
export const KEY_NAMES = [
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NVIDIA_API_KEY",
  "SUPADATA_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

const file = () => path.join(dataDir(), "keys.json");

function secret(): Buffer {
  const s = process.env.KEYS_SECRET || process.env.SESSION_SECRET;
  if (!s) throw new Error("Missing env SESSION_SECRET");
  return crypto.createHash("sha256").update(`user-keys:${s}`).digest();
}

function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function open(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", secret(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readSealed(): Partial<Record<KeyName, string>> {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function apiKey(name: KeyName): string {
  const t = currentTenant();
  if (t.owner) {
    if (name === "GEMINI_API_KEY") return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY ?? "";
    return process.env[name] ?? "";
  }
  const sealed = readSealed()[name];
  return (sealed && open(sealed)) || "";
}

export const hasKey = (name: KeyName) => !!apiKey(name);

export function setKey(name: KeyName, value: string | null) {
  if (currentTenant().owner) throw new Error("The owner's keys live in /etc/agent-dashboard.env");
  const all = readSealed();
  const v = value?.trim();
  if (v) all[name] = seal(v);
  else delete all[name];
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  fs.renameSync(tmp, file());
}

// What the settings page may show: which keys exist and their last four characters, never the key.
export function keyHints(): Record<KeyName, string | null> {
  return Object.fromEntries(KEY_NAMES.map((n) => {
    const k = apiKey(n);
    return [n, k ? `…${k.slice(-4)}` : null];
  })) as Record<KeyName, string | null>;
}
