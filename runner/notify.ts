import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import webpush, { type PushSubscription } from "web-push";
import { listNotices, NOTICES_DIR, PUSH_SUBJECT, readSubscriptions, SUBS_FILE, vapidKeys, type Notice } from "../lib/notifications";

// Runner side of the notification center: creates notices (deduped by key), sends phone pushes within
// the daily cap, and keeps the subscription list (dead ones are pruned on 404/410).

const DAILY_PUSH_CAP = 6;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "notify:", ...a);

function writeAtomic(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, body);
  fs.renameSync(`${file}.tmp`, file);
}

export function saveSubscription(sub: PushSubscription) {
  const subs = readSubscriptions().filter((s) => s.endpoint !== sub.endpoint);
  writeAtomic(SUBS_FILE(), JSON.stringify([...subs, sub].slice(-10)));
}

export function removeSubscription(endpoint: string) {
  writeAtomic(SUBS_FILE(), JSON.stringify(readSubscriptions().filter((s) => s.endpoint !== endpoint)));
}

const pushedToday = () => {
  const day = new Date().toISOString().slice(0, 10);
  return listNotices().filter((n) => n.pushedAt?.startsWith(day)).length;
};

async function push(n: Notice): Promise<boolean> {
  const subs = readSubscriptions();
  if (!subs.length) return false;
  const keys = await vapidKeys();
  const payload = JSON.stringify({ title: n.push?.title ?? "Agentic OS", body: n.push?.body ?? "Something needs you — open to see.", href: n.href, tag: n.key });
  let delivered = false;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload, {
        vapidDetails: { subject: PUSH_SUBJECT, ...keys },
        TTL: n.expiresAt ? Math.max(60, Math.round((new Date(n.expiresAt).getTime() - Date.now()) / 1000)) : 6 * 3600,
        urgency: n.priority === 3 ? "high" : "normal",
        topic: n.key.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
      });
      delivered = true;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) removeSubscription(sub.endpoint);
      else log("push failed", code ?? (e instanceof Error ? e.message : e));
    }
  }
  return delivered;
}

// One live notice per key: a second notify() with the same key while the first is live does nothing.
export async function notify(n: Omit<Notice, "id" | "createdAt" | "pushedAt">): Promise<Notice | null> {
  if (listNotices().some((x) => x.key === n.key)) return null;
  const notice: Notice = { ...n, id: `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`, createdAt: new Date().toISOString() };
  const file = path.join(NOTICES_DIR(), `${notice.id}.json`);
  writeAtomic(file, JSON.stringify(notice, null, 2));
  if (n.priority >= 2 && (n.priority === 3 || pushedToday() < DAILY_PUSH_CAP)) {
    if (await push(notice).catch(() => false)) {
      notice.pushedAt = new Date().toISOString();
      writeAtomic(file, JSON.stringify(notice, null, 2));
    }
  }
  return notice;
}

// Expired notices are cleared once a day.
let swept = "";
export function sweepNotices() {
  const day = new Date().toISOString().slice(0, 10);
  if (swept === day) return;
  swept = day;
  const live = new Set(listNotices().map((n) => n.id));
  try {
    for (const f of fs.readdirSync(NOTICES_DIR())) if (f.endsWith(".json") && !live.has(f.slice(0, -5))) fs.rmSync(path.join(NOTICES_DIR(), f), { force: true });
  } catch {
    /* none yet */
  }
}
