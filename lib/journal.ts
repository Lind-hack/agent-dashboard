import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { addDays } from "./calendar";
import { DATA_DIR } from "./config";

// The journal (v5.1): Lind's day in his own words, typed or spoken. One file per day in
// data/journal/<day>.json (the web app writes it), mirrored to the vault's "100 - Me/journal/<day>.md"
// when that folder is writable. The Buddy and Sol's nightly profile read it; Memory indexes it.
// v5.5: everything he tells the Buddy lands here too (source "buddy"), under its own heading in the note,
// so Obsidian, the graph and the planners all have it. Days the vault missed are swept up nightly.

export type Mood = 1 | 2 | 3 | 4 | 5;
export type JournalEntry = { id: string; at: string; text: string; source: "text" | "voice" | "buddy"; mood?: Mood };
export type JournalDay = { day: string; entries: JournalEntry[] };

const dir = () => path.join(DATA_DIR, "journal");
const file = (day: string) => path.join(dir(), `${day}.json`);
const vaultDir = () => process.env.MEMORY_VAULT_DIR ?? "/home/ubuntu/.hermes/syncthing-sync/lind-brain";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function readJournal(day: string): JournalDay {
  try {
    const j = JSON.parse(fs.readFileSync(file(day), "utf8")) as Partial<JournalDay>;
    const entries = (Array.isArray(j.entries) ? j.entries : []).filter((e) => e?.id && e.text && e.at);
    return { day, entries };
  } catch {
    return { day, entries: [] };
  }
}

export function addEntry(day: string, text: string, source: JournalEntry["source"], mood?: number): JournalEntry {
  if (!DAY.test(day)) throw new Error("bad day");
  const body = text.trim().slice(0, 24_000);
  if (!body) throw new Error("Nothing to save.");
  const j = readJournal(day);
  const e: JournalEntry = { id: crypto.randomBytes(5).toString("hex"), at: new Date().toISOString(), text: body, source, mood: mood && mood >= 1 && mood <= 5 ? (Math.round(mood) as Mood) : undefined };
  j.entries.push(e);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(`${file(day)}.${process.pid}.tmp`, JSON.stringify(j, null, 2));
  fs.renameSync(`${file(day)}.${process.pid}.tmp`, file(day));
  mirror(j);
  return e;
}

export function removeEntry(day: string, id: string): boolean {
  const j = readJournal(day);
  const next = j.entries.filter((e) => e.id !== id);
  if (next.length === j.entries.length) return false;
  j.entries = next;
  fs.writeFileSync(`${file(day)}.${process.pid}.tmp`, JSON.stringify(j, null, 2));
  fs.renameSync(`${file(day)}.${process.pid}.tmp`, file(day));
  mirror(j);
  return true;
}

// The last `n` days that have entries, newest first.
export function recentJournal(today: string, n = 7): JournalDay[] {
  return Array.from({ length: n }, (_, i) => readJournal(addDays(today, -i))).filter((j) => j.entries.length);
}

export function journalDays(): string[] {
  try {
    return fs
      .readdirSync(dir())
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

const MOOD = ["", "rough", "meh", "okay", "good", "great"];
export const moodWord = (m?: number) => (m ? MOOD[m] : "");

// Did he write anything himself today? A chat with the Buddy doesn't cancel "how was your day?".
export const journalWritten = (day: string) => readJournal(day).entries.some((e) => e.source !== "buddy");

const vaultJournal = () => path.join(vaultDir(), "100 - Me", "journal");

// Can notes reach Obsidian? Shown on the Buddy page: on the VPS this needs deploy/vault-access.sh.
export function vaultWritable(): boolean {
  try {
    fs.mkdirSync(vaultJournal(), { recursive: true });
    fs.accessSync(vaultJournal(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Every day the vault doesn't have, or has an older copy of.
export function mirrorAll() {
  const mtime = (f: string) => {
    try {
      return fs.statSync(f).mtimeMs;
    } catch {
      return 0;
    }
  };
  for (const day of journalDays()) if (mtime(file(day)) > mtime(path.join(vaultJournal(), `${day}.md`))) mirror(readJournal(day));
}

function mirror(j: JournalDay) {
  try {
    const d = vaultJournal();
    fs.mkdirSync(d, { recursive: true });
    const time = (e: JournalEntry) => new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: process.env.DASHBOARD_TZ ?? "Europe/Belgrade" });
    const told = j.entries.filter((e) => e.source === "buddy");
    const md = [
      "---",
      "tags: [me, journal]",
      `date: ${j.day}`,
      "source: agents.383ks.com",
      "---",
      "",
      `# Journal — ${j.day}`,
      "",
      ...j.entries.filter((e) => e.source !== "buddy").flatMap((e) => [`## ${time(e)}${e.mood ? ` · ${moodWord(e.mood)}` : ""}${e.source === "voice" ? " · spoken" : ""}`, "", e.text, ""]),
      ...(told.length ? ["## Buddy", "", ...told.flatMap((e) => [`**${time(e)}** ${e.text}`, ""])] : []),
    ].join("\n");
    fs.writeFileSync(path.join(d, `${j.day}.md`), md);
  } catch {
    /* the vault isn't writable yet — the dashboard copy is the source */
  }
}
