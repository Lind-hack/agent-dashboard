import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

// Whose data a piece of code is touching. The owner (Lind) keeps the original data folder, vault and env keys;
// every other account lives in its own folder under tenants/ and never falls back to the owner's keys.
// Web requests set the tenant in lib/guard.ts; the runner runs each user's jobs inside runAs().
export type Tenant = {
  id: string;
  owner: boolean;
  dir: string; // the user's data folder
  vault: string; // the user's Obsidian vault on the server ("" when there is none)
  vaultName: string;
  tz: string;
  name: string;
};

const DEFAULT_TZ = "Europe/Belgrade";
export const ROOT_DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
export const tenantsDir = () => path.join(ROOT_DATA_DIR, "tenants");
export const OWNER_ID = "owner";

// One store per process, even if a bundler loads this module twice.
const g = globalThis as typeof globalThis & { __tenantAls?: AsyncLocalStorage<Tenant> };
const als = (g.__tenantAls ??= new AsyncLocalStorage<Tenant>());

export function ownerTenant(): Tenant {
  return {
    id: OWNER_ID,
    owner: true,
    dir: ROOT_DATA_DIR,
    vault: process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain",
    vaultName: process.env.MEMORY_VAULT_NAME ?? "Lind Brain",
    tz: process.env.DASHBOARD_TZ ?? DEFAULT_TZ,
    name: "Lind",
  };
}

export function userTenant(u: { id: string; name: string; tz?: string; vaultName?: string }): Tenant {
  const dir = path.join(tenantsDir(), u.id);
  return { id: u.id, owner: false, dir, vault: path.join(dir, "vault"), vaultName: u.vaultName || "My vault", tz: validTz(u.tz) ?? DEFAULT_TZ, name: u.name };
}

export function validTz(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

// Inside the Next server a request that never said who it is must not quietly read the owner's data.
// The runner and the tests have no requests: there, no tenant means the owner.
const strict = () => !!process.env.NEXT_RUNTIME && process.env.NEXT_PHASE !== "phase-production-build";

export class NoTenantError extends Error {
  constructor() {
    super("No signed-in user for this request");
  }
}

export function currentTenant(): Tenant {
  const t = als.getStore();
  if (t) return t;
  if (strict()) throw new NoTenantError();
  return ownerTenant();
}

export const maybeTenant = (): Tenant | undefined => als.getStore();
export const runAs = <T>(t: Tenant, fn: () => T): T => als.run(t, fn);

export const dataDir = () => currentTenant().dir;
export const vaultDir = () => currentTenant().vault;
export const vaultName = () => currentTenant().vaultName;
export const userTz = () => currentTenant().tz;
export const isOwner = () => currentTenant().owner;
export const tenantId = () => currentTenant().id;

// Module state that must not cross accounts (caches, "already ran today" flags): one copy per tenant.
// const s = perTenant(() => ({ busy: false })); s().busy = true;
export function perTenant<T>(init: () => T): () => T {
  const m = new Map<string, T>();
  return () => {
    const id = currentTenant().id;
    let v = m.get(id);
    if (v === undefined) m.set(id, (v = init()));
    return v;
  };
}

// The prompts were written for Lind. For anyone else, his name becomes theirs on the way to the model,
// with a note so the model neither guesses their gender nor brings in Lind's life.
export function personalize(text: string, system = false): string {
  const t = currentTenant();
  if (t.owner) return text;
  const name = t.name.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || "the user";
  const out = (system ? withoutOwnerBio(text) : text).replace(/\bLind\b/g, name);
  return system
    ? `${out}\n\n(This dashboard belongs to ${name}. Refer to them by name or as "you"; don't assume their gender, and don't assume anything about their life that isn't in the data given.)`
    : out;
}

// Sentences about Lind's own life (his studies, TikTok, news site, agency) are dropped for anyone else, so
// their coach doesn't think they run his projects. Whole sentences go; the instructions around them stay.
const OWNER_BIO = /\b(CS student|Pristina|@building\.ai|TikTok|383 news site|the 383|news site in Kosovo|AI agency|AI automation agency|200k)\b/i;
export function withoutOwnerBio(text: string): string {
  return text
    .split(/(?<=[.!?;])(?=\s)/)
    // Only sentences about Lind himself: a user's own note that mentions TikTok stays.
    .filter((s) => !(OWNER_BIO.test(s) && /\bLind\b|\b[Hh]e(?:'s| is| runs)\b|^\s*(?:Lind|He)\b/.test(s)))
    .join("")
    .replace(/^\s+/, "");
}
