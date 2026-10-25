#!/usr/bin/env node
// One-time Google sign-in for the dashboard's Calendar page. Run on the PC (it opens your browser):
//
//   node handoff/google-auth.mjs [path/to/google_credentials.json]
//
// Uses the same OAuth desktop client as the morning-news tools, asks only for Calendar access
// (read your calendars + add events), and sends the refresh token straight to the dashboard
// (Bearer HANDOFF_TOKEN from ~/.agent-dashboard/handoff.env). Nothing is written to disk here.

import { exec } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events"];
const credsPath = process.argv[2] ?? path.join(os.homedir(), "Desktop", "claude", "tools", "google_credentials.json");

const readEnv = (file) =>
  Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );

let env, client;
try {
  env = readEnv(path.join(os.homedir(), ".agent-dashboard", "handoff.env"));
  const raw = JSON.parse(fs.readFileSync(credsPath, "utf8"));
  client = raw.installed ?? raw.web;
} catch (e) {
  console.error(`Couldn't read ${credsPath} or ~/.agent-dashboard/handoff.env: ${e.message}`);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const code = url.searchParams.get("code");
  if (!code) {
    res.end(url.searchParams.get("error") ?? "waiting…");
    return;
  }
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  }).then((r) => r.json());
  if (!tok.refresh_token) {
    res.end("Google didn't return a refresh token — run the script again.");
    console.error("No refresh token:", tok.error_description ?? tok.error ?? "unknown");
    process.exit(1);
  }
  const sent = await fetch(`${env.AGENT_DASHBOARD_URL ?? "https://agents.383ks.com"}/api/calendar/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.HANDOFF_TOKEN}` },
    body: JSON.stringify({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tok.refresh_token, scopes: tok.scope?.split(" ") }),
  });
  const ok = sent.ok;
  res.end(ok ? "Calendar connected — you can close this tab." : `The dashboard refused it (${sent.status}).`);
  console.log(ok ? "Calendar connected to the dashboard." : `Dashboard refused the token (${sent.status}).`);
  server.close();
  process.exit(ok ? 0 : 1);
});

server.listen(0, "127.0.0.1", () => {
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: `http://127.0.0.1:${server.address().port}`,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  }).toString();
  console.log("Opening Google sign-in… if nothing opens, paste this into your browser:\n" + auth);
  exec(process.platform === "win32" ? `start "" "${auth}"` : `open "${auth}" || xdg-open "${auth}"`);
});
