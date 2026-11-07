import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withLock } from "./file-lock";
import { OWNER_ID, ownerTenant, ROOT_DATA_DIR, runAs, userTenant, validTz, type Tenant } from "./tenant";

// Accounts besides the owner. The owner (Lind) still signs in with DASHBOARD_PASSWORD and keeps the original
// data folder; everyone else signs up with an invite code and gets tenants/<id>/. Passwords are scrypt hashes.
export type User = {
  id: string;
  email: string;
  name: string;
  hash: string; // scrypt: salt.hash, hex
  tz: string;
  createdAt: string;
  invite: string;
  session: number; // bumping it signs the user out everywhere
  disabled?: boolean;
  vaultName?: string;
  setupDone?: boolean;
};

export type Invite = { code: string; createdAt: string; note?: string; usedBy?: string; usedAt?: string };

const usersFile = () => path.join(ROOT_DATA_DIR, "users.json");
const invitesFile = () => path.join(ROOT_DATA_DIR, "invites.json");
const asRoot = <T>(fn: () => T) => runAs(ownerTenant(), fn);

function readJSON<T>(file: string): T[] {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function writeJSON(file: string, v: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export const listUsers = (): User[] => readJSON<User>(usersFile()).filter((u) => u && typeof u.id === "string" && typeof u.email === "string");
export const findUser = (id: string) => listUsers().find((u) => u.id === id);
export const listInvites = (): Invite[] => readJSON<Invite>(invitesFile()).filter((i) => i && typeof i.code === "string");

export const normEmail = (e: string) => e.trim().toLowerCase();
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}.${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

function checkPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(".");
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function tenantOf(u: User): Tenant {
  return userTenant(u);
}

export function tenantById(id: string): Tenant | null {
  if (id === OWNER_ID) return ownerTenant();
  const u = findUser(id);
  return u && !u.disabled ? tenantOf(u) : null;
}

export class SignupError extends Error {}

export function signUp(input: { email: string; name: string; password: string; invite: string; tz?: string }): User {
  const email = normEmail(input.email ?? "");
  const name = String(input.name ?? "").trim().slice(0, 60);
  const code = String(input.invite ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!EMAIL.test(email)) throw new SignupError("That email doesn't look right");
  if (!name) throw new SignupError("Add your name");
  if (String(input.password ?? "").length < 10) throw new SignupError("Use a password of at least 10 characters");
  if (String(input.password).length > 200) throw new SignupError("That password is too long");
  return asRoot(() =>
    withLock("users", () => {
      const users = listUsers();
      const invites = listInvites();
      const inv = code ? invites.find((i) => i.code.replace(/-/g, "") === code) : undefined;
      if (!inv || inv.usedBy) throw new SignupError("That invite code isn't valid or was already used");
      if (users.some((u) => u.email === email)) throw new SignupError("There's already an account with that email");
      const u: User = {
        id: `u_${crypto.randomBytes(8).toString("hex")}`,
        email,
        name,
        hash: hashPassword(input.password),
        tz: validTz(input.tz) ?? "UTC",
        createdAt: new Date().toISOString(),
        invite: inv.code,
        session: 1,
      };
      inv.usedBy = u.id;
      inv.usedAt = u.createdAt;
      writeJSON(usersFile(), [...users, u]);
      writeJSON(invitesFile(), invites);
      fs.mkdirSync(tenantOf(u).dir, { recursive: true, mode: 0o700 });
      return u;
    }),
  );
}

// A wrong email and a wrong password take the same time and give the same answer.
const DUMMY = hashPassword(crypto.randomBytes(8).toString("hex"));
export function logIn(email: string, password: string): User | null {
  const u = listUsers().find((x) => x.email === normEmail(email ?? ""));
  const ok = checkPassword(String(password ?? ""), u?.hash ?? DUMMY);
  return u && ok && !u.disabled ? u : null;
}

export function updateUser(id: string, patch: Partial<Pick<User, "name" | "tz" | "vaultName" | "setupDone" | "disabled">> & { password?: string; signOutEverywhere?: boolean }): User {
  return asRoot(() =>
    withLock("users", () => {
      const users = listUsers();
      const u = users.find((x) => x.id === id);
      if (!u) throw new Error("No such user");
      if (patch.name !== undefined) u.name = String(patch.name).trim().slice(0, 60) || u.name;
      if (patch.tz !== undefined) u.tz = validTz(patch.tz) ?? u.tz;
      if (patch.vaultName !== undefined) u.vaultName = String(patch.vaultName).trim().slice(0, 60);
      if (patch.setupDone !== undefined) u.setupDone = !!patch.setupDone;
      if (patch.disabled !== undefined) {
        u.disabled = !!patch.disabled;
        u.session += 1;
      }
      if (patch.password !== undefined) {
        if (patch.password.length < 10) throw new SignupError("Use a password of at least 10 characters");
        u.hash = hashPassword(patch.password);
        u.session += 1;
      }
      if (patch.signOutEverywhere) u.session += 1;
      writeJSON(usersFile(), users);
      return u;
    }),
  );
}

// Deleting an account removes its folder too: nothing of theirs stays on the server.
export function deleteUser(id: string) {
  asRoot(() =>
    withLock("users", () => {
      const users = listUsers();
      const u = users.find((x) => x.id === id);
      if (!u) return;
      writeJSON(usersFile(), users.filter((x) => x.id !== id));
      const dir = tenantOf(u).dir;
      if (path.basename(path.dirname(dir)) === "tenants" && dir.includes(u.id)) fs.rmSync(dir, { recursive: true, force: true });
    }),
  );
}

export function createInvite(note?: string): Invite {
  return asRoot(() =>
    withLock("users", () => {
      const invites = listInvites();
      // No 0/O or 1/I: codes get read out loud and typed on phones.
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join("").replace(/(.{5})(.{5})/, "$1-$2");
      const inv: Invite = { code, createdAt: new Date().toISOString(), note: note?.trim().slice(0, 80) || undefined };
      writeJSON(invitesFile(), [...invites, inv]);
      return inv;
    }),
  );
}

export function revokeInvite(code: string) {
  asRoot(() =>
    withLock("users", () => {
      writeJSON(invitesFile(), listInvites().filter((i) => i.code !== code || i.usedBy));
    }),
  );
}
