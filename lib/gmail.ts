import fs from "node:fs";
import path from "node:path";
import { accessToken, gmailConnected } from "./calendar";
import { DATA_DIR } from "./config";
import { listAccounts } from "./accounts";
import { groqJSON } from "./groq";
import { extraMail } from "./mail-sources";

// Gmail in the Inbox (developers.google.com/workspace/gmail/api/reference/rest): read-only. The last
// week of the inbox is cached in data/mail/messages.json; piles (what the Core sorted each message
// into) and "done" live next to it. Gmail's own labels are never touched.

export const PILES = [
  { key: "reply", label: "Reply today", hint: "a real person waiting on Lind's answer, time-sensitive" },
  { key: "leads", label: "Leads", hint: "potential clients for the AI agency, inbound work requests" },
  { key: "sponsors", label: "Sponsors", hint: "brand deals, integrations, paid promotions for @building.ai" },
  { key: "billing", label: "Billing", hint: "invoices, receipts, payments, subscriptions, bank" },
  { key: "community", label: "Community", hint: "comments, followers, group posts, social notifications" },
  { key: "newsletters", label: "Newsletters", hint: "newsletters, digests, product updates" },
  { key: "fyi", label: "FYI", hint: "worth knowing, no action: confirmations, security alerts, shipping" },
  { key: "spam", label: "Spam", hint: "cold spam, scams, irrelevant promotions" },
] as const;
export type PileKey = (typeof PILES)[number]["key"];
const PILE_KEYS = new Set<string>(PILES.map((p) => p.key));

export type Mail = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  at: string;
  unread: boolean;
  attachments: string[];
  account?: string; // set for extra accounts (v5.1); unset = the main Gmail
  link?: string; // where to open it, for extra accounts
};
export type Sorted = { pile: PileKey; why: string; at: string };

const dir = () => path.join(DATA_DIR, "mail");
const json = <T,>(name: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir(), name), "utf8")) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (name: string, v: unknown) => {
  fs.mkdirSync(dir(), { recursive: true });
  const f = path.join(dir(), name);
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(v));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
};

export { gmailConnected };
// Mail is worth fetching when the main Gmail or any extra account is connected.
export const mailConnected = () => gmailConnected() || listAccounts().length > 0;
export const readMail = () => json<{ at?: string; messages: Mail[]; error?: string }>("messages.json", { messages: [] });
export const readPiles = () => json<Record<string, Sorted>>("piles.json", {});
export const readDone = () => json<Record<string, string>>("done.json", {});
export const readSortStats = () => json<{ sorted: number; ms: number; at?: string }>("sort-stats.json", { sorted: 0, ms: 0 });

export function markMailDone(ids: string[]) {
  const done = readDone();
  for (const id of ids) done[id] = new Date().toISOString();
  write("done.json", done);
}

export function movePile(id: string, pile: string) {
  if (!PILE_KEYS.has(pile)) return false;
  const piles = readPiles();
  piles[id] = { pile: pile as PileKey, why: "moved by Lind", at: new Date().toISOString() };
  write("piles.json", piles);
  return true;
}

async function gmail<T>(url: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${url}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !body) throw new Error(`Gmail: ${body?.error?.message ?? res.status}`);
  return body;
}

type Part = { filename?: string; parts?: Part[] };
const files = (p?: Part): string[] => [...(p?.filename ? [p.filename] : []), ...(p?.parts ?? []).flatMap(files)];

// The last 7 days of every inbox — the main Gmail plus the extra accounts — metadata only.
export async function refreshMail(): Promise<{ messages: Mail[]; error?: string }> {
  if (!mailConnected()) return { messages: [], error: "not connected" };
  const old = new Map(readMail().messages.map((m) => [m.id, m]));
  const extra = await extraMail(old);
  const main = gmailConnected() ? await refreshMainGmail(old) : { messages: [] as Mail[] };
  const out = [...main.messages, ...extra.messages].sort((a, b) => b.at.localeCompare(a.at));
  const error = [main.error, ...extra.errors].filter(Boolean).join(" · ") || undefined;
  if (main.error && !main.messages.length && !extra.messages.length) {
    write("messages.json", { ...readMail(), error });
    return { messages: readMail().messages, error };
  }
  write("messages.json", { at: new Date().toISOString(), messages: out, ...(error ? { error } : {}) });
  return { messages: out };
}

async function refreshMainGmail(old: Map<string, Mail>): Promise<{ messages: Mail[]; error?: string }> {
  try {
    const ids: string[] = [];
    let page = "";
    do {
      const list = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?maxResults=100&q=${encodeURIComponent("in:inbox newer_than:7d")}${page ? `&pageToken=${page}` : ""}`);
      ids.push(...(list.messages ?? []).map((m) => m.id));
      page = list.nextPageToken ?? "";
    } while (page && ids.length < 150);
    const out: Mail[] = [];
    // Unchanged messages come from the cache except for the unread flag, which is cheap to refetch.
    for (let i = 0; i < ids.length; i += 8) {
      const batch = await Promise.all(
        ids.slice(i, i + 8).map(async (id) => {
          const m = await gmail<{ id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: Part & { headers?: { name: string; value: string }[] } }>(
            `/messages/${id}?format=${old.has(id) ? "minimal" : "metadata"}&metadataHeaders=From&metadataHeaders=Subject`,
          ).catch(() => null);
          if (!m) return old.get(id) ?? null;
          const prev = old.get(id);
          if (prev) return { ...prev, unread: !!m.labelIds?.includes("UNREAD") };
          const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
          const from = header("from");
          const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
          return {
            id: m.id,
            threadId: m.threadId,
            from: from.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "") || from,
            fromEmail: from.match(/<([^>]+)>/)?.[1] ?? from,
            subject: header("subject") || "(no subject)",
            snippet: decode(m.snippet ?? ""),
            at: new Date(Number(m.internalDate) || Date.now()).toISOString(),
            unread: !!m.labelIds?.includes("UNREAD"),
            attachments: files(m.payload).slice(0, 4),
          } satisfies Mail;
        }),
      );
      out.push(...batch.filter((x): x is Mail => !!x));
    }
    return { messages: out };
  } catch (e) {
    // The main inbox failed: keep its last good copy so the merge doesn't drop it.
    return { messages: [...old.values()].filter((m) => !m.account), error: e instanceof Error ? e.message : String(e) };
  }
}

// Groq's free tier allows ~8k tokens a minute on this key, so mail goes in small, paced batches:
// 12 at a time, a short pause between, one longer wait and retry when a batch is refused. `limit`
// caps one call (the Sort button) so the request can't time out; the runner sorts the rest.
const BATCH = 12;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sortMail(all = false, limit = Infinity): Promise<{ sorted: number; ms: number; left: number }> {
  const t0 = Date.now();
  const piles = readPiles();
  const todo = readMail().messages.filter((m) => all || !piles[m.id]).filter((m) => piles[m.id]?.why !== "moved by Lind");
  const take = todo.slice(0, limit);
  let sorted = 0;
  for (let i = 0; i < take.length; i += BATCH) {
    const batch = take.slice(i, i + BATCH);
    if (i) await sleep(7_000);
    const ask = () => groqJSON<{ items: { n: number; pile: string; why: string }[] }>(
      `You sort Lind's email into piles. Lind runs @building.ai (a 200k-follower AI/tech TikTok), an AI automation agency, and the 383 news site in Kosovo.
Piles:
${PILES.map((p) => `- ${p.key}: ${p.hint}`).join("\n")}
Return JSON {"items": [{"n": number, "pile": string, "why": string (≤10 words)}]} with one entry per message.`,
      batch.map((m, n) => `[${n}]${m.account ? ` (to ${m.account})` : ""} From: ${m.from} <${m.fromEmail}>\nSubject: ${m.subject}\n${m.snippet.slice(0, 200)}${m.attachments.length ? `\nAttachments: ${m.attachments.join(", ")}` : ""}`).join("\n\n"),
      0.1,
      { maxTokens: 1200 },
    );
    let out = await ask();
    if (!out?.items) {
      await sleep(30_000); // the minute's token budget refills
      out = await ask();
    }
    if (!out?.items) break; // still refused — the next run carries on from here
    for (const r of out?.items ?? []) {
      const m = batch[r?.n];
      if (!m || !PILE_KEYS.has(r.pile)) continue;
      piles[m.id] = { pile: r.pile as PileKey, why: String(r.why ?? "").slice(0, 120), at: new Date().toISOString() };
      sorted++;
    }
  }
  // Merge into the file as it is now: a pile Lind picked while the Core was thinking stays his.
  const current = readPiles();
  for (const [id, v] of Object.entries(piles)) if (current[id]?.why !== "moved by Lind") current[id] = v;
  write("piles.json", current);
  const stats = { sorted, ms: Date.now() - t0, at: new Date().toISOString() };
  if (sorted) write("sort-stats.json", stats);
  return { ...stats, left: todo.length - sorted };
}

export const gmailLink = (m: Mail) => m.link ?? `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`;

// The main account's address (for labels), asked once and remembered.
let mainEmail: string | null = null;
export async function primaryEmail(): Promise<string | null> {
  if (mainEmail || !gmailConnected()) return mainEmail;
  const cached = json<{ email?: string }>("profile.json", {});
  if (cached.email) return (mainEmail = cached.email);
  const p = await gmail<{ emailAddress?: string }>("/profile").catch(() => null);
  if (p?.emailAddress) {
    write("profile.json", { email: p.emailAddress });
    mainEmail = p.emailAddress;
  }
  return mainEmail;
}
