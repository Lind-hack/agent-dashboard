#!/usr/bin/env node
// Pushes Claude Code's memory notes from this PC to the dashboard's Memory page.
//
//   node handoff/sync-notes.mjs [notes-dir]
//
// Default dir: ~/.claude/projects/C--Users-PC1/memory. Replaces the copy on the VPS each run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.argv[2] ?? path.join(os.homedir(), ".claude", "projects", "C--Users-PC1", "memory");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(os.homedir(), ".agent-dashboard", "handoff.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".md"))
  .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));

const res = await fetch(`${env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com"}/api/memory/notes`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.HANDOFF_TOKEN}` },
  body: JSON.stringify({ files }),
});
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`Sync failed (${res.status}): ${body?.error ?? "unknown error"}`);
  process.exit(1);
}
console.log(`Synced ${body.count} notes to the dashboard.`);
