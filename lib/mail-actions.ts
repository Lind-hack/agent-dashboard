import fs from "node:fs";
import path from "node:path";
import { googleToken, listAccounts } from "./accounts";
import { accessToken, gmailConnected } from "./calendar";
import { DATA_DIR } from "./config";
import { readMail, readPiles, type Mail } from "./gmail";
import { groqJSON } from "./groq";

// Email → action (v5.1).
// - The runner reads mail that was sorted into a pile that usually needs Lind (reply, leads, sponsors,
//   billing) and writes what each one asks of him to data/mail/actions.json. The web app turns those
//   into tasks on the next Today load (it's the only writer of data/todos.json).
// - Reply drafts go into the account's Gmail Drafts folder (gmail.compose); nothing is ever sent.

export type MailAction = { id: string; needsAction: boolean; title?: string; due?: string; estimateMin?: number; priority?: 0 | 1 | 2 | 3; at: string };

const file = () => path.join(DATA_DIR, "mail", "actions.json");
export const readActions = (): Record<string, MailAction> => {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8")) ?? {};
  } catch {
    return {};
  }
};
function writeActions(v: Record<string, MailAction>) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.${process.pid}.tmp`, JSON.stringify(v));
  fs.renameSync(`${file()}.${process.pid}.tmp`, file());
}

const ACTION_PILES = new Set(["reply", "leads", "sponsors", "billing"]);

// Runner: up to 12 new messages per run, one Groq call.
export async function extractMailActions(today: string): Promise<number> {
  const piles = readPiles();
  const done = readActions();
  const todo = readMail()
    .messages.filter((m) => ACTION_PILES.has(piles[m.id]?.pile ?? "") && !done[m.id])
    .slice(0, 12);
  if (!todo.length) return 0;
  const out = await groqJSON<{ items: { n: number; needs_action: boolean; title?: string; due?: string; minutes?: number; priority?: number }[] }>(
    `You read Lind's email and decide what each one asks him to DO. Today is ${today}.
Return JSON {"items": [{"n": number, "needs_action": boolean, "title": "<a task, starting with a verb, ≤10 words, in the email's language>", "due": "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" or null, "minutes": number, "priority": 0-3}]}, one per email.
needs_action is false for receipts, confirmations and anything that only informs. Use a due date only when the email states or clearly implies one. minutes = a realistic estimate (5-120).`,
    todo.map((m, n) => `[${n}] From: ${m.from} <${m.fromEmail}>${m.account ? ` (to ${m.account})` : ""}\nSubject: ${m.subject}\n${m.snippet.slice(0, 300)}`).join("\n\n"),
    0.1,
    { maxTokens: 1500 },
  );
  if (!out?.items) return 0;
  const at = new Date().toISOString();
  for (const r of out.items) {
    const m = todo[r?.n];
    if (!m) continue;
    done[m.id] = {
      id: m.id,
      needsAction: !!r.needs_action && !!r.title,
      title: r.title ? String(r.title).slice(0, 160) : undefined,
      due: typeof r.due === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(r.due) ? r.due : undefined,
      estimateMin: Math.max(5, Math.min(120, Number(r.minutes) || 15)),
      priority: ([0, 1, 2, 3].includes(Number(r.priority)) ? Number(r.priority) : 1) as MailAction["priority"],
      at,
    };
  }
  // Keep a month of decisions so old mail isn't re-read.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  writeActions(Object.fromEntries(Object.entries(done).filter(([, v]) => v.at >= cutoff)));
  return todo.length;
}

// ---- reply drafts -----------------------------------------------------------------------------------

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function tokenFor(m: Mail): Promise<{ token: string; email?: string } | null> {
  if (!m.account) return gmailConnected() ? { token: await accessToken() } : null;
  const a = listAccounts().find((x) => x.email === m.account);
  if (!a || a.provider !== "google" || !a.scopes?.some((s) => s.includes("gmail.compose"))) return null;
  return { token: await googleToken(a), email: a.email };
}

export function draftsAllowed(m: Mail): boolean {
  if (!m.account) return true;
  const a = listAccounts().find((x) => x.email === m.account);
  return a?.provider === "google" && !!a.scopes?.some((s) => s.includes("gmail.compose"));
}

// Writes a reply with Groq (Lind's note steers it) and saves it as a draft in that account's Gmail.
export async function draftReply(mailId: string, note = ""): Promise<{ ok: true; body: string; link: string } | { ok: false; error: string }> {
  const m = readMail().messages.find((x) => x.id === mailId);
  if (!m) return { ok: false, error: "That email isn't in the last week of mail." };
  const auth = await tokenFor(m).catch(() => null);
  if (!auth) return { ok: false, error: m.account ? `Drafts work for Gmail accounts connected with google-auth --add (${m.account} isn't).` : "Run google-auth again once — drafts need the new Gmail compose permission." };
  const raw = m.id.includes(":") ? m.id.slice(m.id.indexOf(":") + 1) : m.id;
  const g = async <T,>(url: string, init?: RequestInit) => {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${url}`, { ...init, headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000) });
    const b = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!res.ok || !b) throw new Error(b?.error?.message ?? String(res.status));
    return b;
  };
  try {
    const orig = await g<{ threadId: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(`/messages/${raw}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=References`);
    const h = (n: string) => orig.payload?.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const text = await groqJSON<{ body: string }>(
      `You draft an email reply for Lind (CS student in Pristina; runs the @building.ai TikTok, an AI agency and the 383 news site). Write in the language of the email, warm and brief, ready to send; no placeholders like [Name] — if something is unknown, keep it general. Sign as "Lind". Return JSON {"body": string}.`,
      `From: ${m.from} <${m.fromEmail}>\nSubject: ${m.subject}\n\n${orig.snippet ?? m.snippet}\n\nWhat Lind wants to say: ${note || "(reply sensibly)"}`,
      0.5,
      { maxTokens: 700 },
    );
    if (!text?.body) return { ok: false, error: "Couldn't write the reply right now (Groq is busy) — try again in a minute." };
    const subject = /^re:/i.test(h("subject")) ? h("subject") : `Re: ${h("subject") || m.subject}`;
    const mime = [
      `To: ${h("reply-to") || h("from")}`,
      `Subject: ${subject}`,
      ...(h("message-id") ? [`In-Reply-To: ${h("message-id")}`, `References: ${[h("references"), h("message-id")].filter(Boolean).join(" ")}`] : []),
      "Content-Type: text/plain; charset=UTF-8",
      "",
      text.body,
    ].join("\r\n");
    await g("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: b64url(mime), threadId: orig.threadId } }) });
    const authuser = auth.email ? `/?authuser=${encodeURIComponent(auth.email)}` : "/u/0/";
    return { ok: true, body: text.body, link: `https://mail.google.com/mail${authuser}#drafts` };
  } catch (e) {
    return { ok: false, error: `Gmail refused the draft: ${e instanceof Error ? e.message : e}` };
  }
}
