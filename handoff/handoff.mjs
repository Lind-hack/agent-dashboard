#!/usr/bin/env node
// Sends a hand-off to the agent dashboard: the VPS continues `--branch` of `--repo` with the summary
// as its brief. Reads HANDOFF_TOKEN and AGENT_DASHBOARD_URL from ~/.agent-dashboard/handoff.env.
//
//   node handoff.mjs --repo Lind-hack/383lajme --branch handoff/x --title "..." --summary-file s.md [--agent codex]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);

const envFile = path.join(os.homedir(), ".agent-dashboard", "handoff.env");
let env = {};
try {
  env = Object.fromEntries(
    fs
      .readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
} catch {
  console.error(`Missing ${envFile} (HANDOFF_TOKEN=..., AGENT_DASHBOARD_URL=...)`);
  process.exit(1);
}

if (!args.repo || !args.branch || !args["summary-file"]) {
  console.error("Usage: node handoff.mjs --repo owner/name --branch <branch> --summary-file <file> [--title t] [--agent claude|codex]");
  process.exit(1);
}

const res = await fetch(`${env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com"}/api/handoff`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.HANDOFF_TOKEN}` },
  body: JSON.stringify({
    repo: args.repo,
    branch: args.branch,
    title: args.title,
    agent: args.agent,
    summary: fs.readFileSync(args["summary-file"], "utf8"),
  }),
});
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`Hand-off failed (${res.status}): ${body?.error ?? "unknown error"}`);
  process.exit(1);
}
console.log(body.url);
