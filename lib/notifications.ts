import fs from "node:fs";
import path from "node:path";
import type { PushSubscription } from "web-push";
import { DATA_DIR } from "./config";

// The notification center (PLAN-v2 R22). The in-app record is the source of truth: everything the OS
// wants Lind to see (the 07:00 plan, check-in questions, the evening review, failures) is a notice in
// data/notifications/, shown in the Inbox. Phone push is only a pointer to it, with generic text for
// anything personal. Only the runner writes notices and subscriptions; the web app asks via the inbox.

export type Notice = {
  id: string;
  key: string; // dedupe: one live notice per key
  kind: "plan" | "checkin" | "review" | "goal" | "system" | "test";
  title: string; // shown in the app
  body: string;
  push?: { title: string; body: string }; // lock-screen text; defaults to a generic line
  href: string;
  priority: 1 | 2 | 3; // 3 = always pushed (07:00 plan, evening review), 1 = in-app only
  createdAt: string;
  expiresAt?: string;
  pushedAt?: string;
};

export const NOTICES_DIR = () => path.join(DATA_DIR, "notifications");
const PUSH_DIR = () => path.join(DATA_DIR, "push");
export const VAPID_FILE = () => path.join(PUSH_DIR(), "vapid.json");
export const SUBS_FILE = () => path.join(PUSH_DIR(), "subscriptions.json");
export const PUSH_SUBJECT = "https://agents.383ks.com";

export function listNotices(): Notice[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(NOTICES_DIR()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const now = new Date().toISOString();
  return files
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(NOTICES_DIR(), f), "utf8")) as Notice];
      } catch {
        return [];
      }
    })
    .filter((n) => !n.expiresAt || n.expiresAt > now)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// VAPID keys are made once and never regenerated (new keys would silently kill every subscription).
// O_EXCL so the web app and the runner can't both create them.
export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  try {
    return JSON.parse(fs.readFileSync(VAPID_FILE(), "utf8"));
  } catch {
    const { default: webpush } = await import("web-push");
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(PUSH_DIR(), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(VAPID_FILE(), JSON.stringify(keys), { flag: "wx", mode: 0o600 });
      return keys;
    } catch {
      return JSON.parse(fs.readFileSync(VAPID_FILE(), "utf8"));
    }
  }
}

export function readSubscriptions(): PushSubscription[] {
  try {
    const s = JSON.parse(fs.readFileSync(SUBS_FILE(), "utf8"));
    return Array.isArray(s) ? s : [];
  } catch {
    return [];
  }
}

export function validSubscription(s: unknown): s is PushSubscription {
  const x = s as PushSubscription;
  return !!x && typeof x.endpoint === "string" && /^https:\/\//.test(x.endpoint) && x.endpoint.length < 1000 && typeof x.keys?.p256dh === "string" && typeof x.keys?.auth === "string";
}
