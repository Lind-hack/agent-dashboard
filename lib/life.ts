import fs from "node:fs";
import path from "node:path";
import { readProfile } from "./buddy";

import { moodWord, recentJournal } from "./journal";
import { dataDir, vaultDir } from "./tenant";

// Where Lind really is (v5.5, Lind: "it tells me to cold email 100 businesses when 383ks.com isn't even
// launched"). Two things every planner shares: his stage, in his own words on the Goals page, and
// lifeContext(), which is that plus the Buddy's notes and what he said this week. The Mentor, the
// Today planner and the Buddy all read the same picture. data/stage.md, mirrored to the vault.

const file = () => path.join(dataDir(), "stage.md");
const vaultFile = () => path.join(vaultDir(), "100 - Me", "Where I am now.md");
const STAGE_MAX = 8000;
const JOURNAL_MAX = 5000;

export function readStage(): { text: string; at?: string } {
  try {
    return { text: fs.readFileSync(file(), "utf8").trim(), at: fs.statSync(file()).mtime.toISOString() };
  } catch {
    return { text: "" };
  }
}

export function saveStage(text: string): { text: string; at?: string } {
  const body = text.trim().slice(0, STAGE_MAX);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.${process.pid}.tmp`, `${body}\n`);
  fs.renameSync(`${file()}.${process.pid}.tmp`, file());
  try {
    fs.mkdirSync(path.dirname(vaultFile()), { recursive: true });
    fs.writeFileSync(vaultFile(), ["---", "tags: [me, stage]", `modified: ${new Date().toISOString()}`, "source: agents.383ks.com", "---", "", "# Where I am now", "", body, ""].join("\n"));
  } catch {
    /* the vault isn't writable yet — the dashboard copy is the source */
  }
  return readStage();
}

// The week in his words, newest first, cut to size: a long dictation mustn't crowd out the rest.
function weekBlock(today: string): string {
  const lines: string[] = [];
  let left = JOURNAL_MAX;
  for (const j of recentJournal(today, 7)) {
    for (const e of [...j.entries].reverse()) {
      const line = `- ${j.day}${e.source === "buddy" ? " (told the Buddy)" : ""}${e.mood ? ` (${moodWord(e.mood)})` : ""}: ${e.text.replace(/\s+/g, " ").slice(0, 500)}`;
      if (left - line.length < 0) return lines.join("\n");
      left -= line.length;
      lines.push(line);
    }
  }
  return lines.join("\n");
}

export function lifeContext(today: string): string {
  const stage = readStage().text;
  return [
    `Where Lind says he is right now, in his own words. This overrides everything else here and anything you assume:\n${stage || "(He hasn't written this yet. Don't assume any business is live, has customers or has an audience: go by what's below, and say what you're unsure of.)"}`,
    `The Buddy's notes on him (updated nightly):\n${readProfile().text.slice(0, 4000) || "(none yet)"}`,
    `What he's been saying this week (journal, and what he told the Buddy):\n${weekBlock(today) || "(nothing this week)"}`,
  ].join("\n\n");
}
