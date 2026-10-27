import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { databaseChats, fileChats, openCodeChat } from "../lib/transcript";

const old = Date.now() - 3600_000;
test("OpenCode exports retain dialogue, exclude tool data, and defer active chats", () => {
  const data = { info: { id: "ses_123", title: "Bug fix", directory: "/repo", time: { created: old, updated: old } }, messages: [
    { info: { role: "user" }, parts: [{ type: "text", text: "Fix the timer" }] },
    { info: { role: "assistant" }, parts: [{ type: "text", text: "Fixed" }, { type: "tool", text: "tool secret" }] },
  ] };
  const chat = openCodeChat(data, "fixture");
  assert.match(chat!.text, /Fix the timer/);
  assert.match(chat!.text, /Fixed/);
  assert.doesNotMatch(chat!.text, /tool secret/);
  data.info.time.updated = Date.now();
  assert.equal(openCodeChat(data, "fixture"), null);
});

test("Hermes reads SQLite sessions, acknowledges completed iteration and captures new messages", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-memory-"));
  const db = path.join(dir, "state.db");
  const prior = { db: process.env.MEMORY_HERMES_DB, oc: process.env.OPENCODE_BIN };
  process.env.MEMORY_HERMES_DB = db;
  process.env.OPENCODE_BIN = path.join(dir, "absent-opencode");
  const python = process.platform === "win32" ? "python" : "python3";
  execFileSync(python, ["-c", `import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
c.executescript("CREATE TABLE sessions(id TEXT,title TEXT,started_at REAL); CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT,role TEXT,content TEXT,timestamp REAL);")
c.execute("INSERT INTO sessions VALUES ('chat', 'Timer bug', ?)", (${old}/1000,))
c.executemany("INSERT INTO messages(session_id,role,content,timestamp) VALUES ('chat',?,?,?)", [('user','Timer broken',${old}/1000),('assistant','Fixed timer',${old}/1000)])
c.commit()`, db]);
  try {
    const seen: Record<string, string> = {};
    const errors: string[] = [];
    const collect = async () => {
      const out = [];
      for await (const item of databaseChats(seen, (_, err) => errors.push(err))) out.push(item);
      return out;
    };
    const pending = databaseChats(seen, (_, err) => errors.push(err));
    assert.equal((await pending.next()).value?.agent, "hermes");
    await pending.return(undefined); // failed upload: cursor must stay retryable
    assert.deepEqual(seen, {});
    assert.equal((await collect()).length, 1);
    assert.equal((await collect()).length, 0);
    execFileSync(python, ["-c", `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute("INSERT INTO messages(session_id,role,content,timestamp) VALUES ('chat','user','Another annoyance',?)", (${old + 1000}/1000,)); c.commit()`, db]);
    assert.match((await collect())[0].text, /Another annoyance/);
    assert.deepEqual(errors, []);
  } finally {
    if (prior.db === undefined) delete process.env.MEMORY_HERMES_DB; else process.env.MEMORY_HERMES_DB = prior.db;
    if (prior.oc === undefined) delete process.env.OPENCODE_BIN; else process.env.OPENCODE_BIN = prior.oc;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude and Codex collectors capture quiet sessions once and skip active files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-memory-"));
  const previous = [process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME];
  process.env.CLAUDE_CONFIG_DIR = path.join(root, "claude");
  process.env.CODEX_HOME = path.join(root, "codex");
  fs.mkdirSync(path.join(root, "claude/projects/repo"), { recursive: true });
  fs.mkdirSync(path.join(root, "codex/sessions"), { recursive: true });
  const claude = path.join(root, "claude/projects/repo/chat.jsonl");
  const codex = path.join(root, "codex/sessions/rollout-123.jsonl");
  fs.writeFileSync(claude, [JSON.stringify({ type: "user", message: { content: "Discuss business" } }), JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Try a subscription" }] } })].join("\n"));
  fs.writeFileSync(codex, ["user", "assistant"].map((role) => JSON.stringify({ type: "response_item", payload: { type: "message", role, content: [{ text: role === "user" ? "Fix bug" : "Fixed" }] } })).join("\n"));
  fs.utimesSync(claude, old / 1000, old / 1000);
  fs.utimesSync(codex, old / 1000, old / 1000);
  try {
    const seen = {};
    const errors: string[] = [];
    const collect = async () => {
      const out = [];
      for await (const item of fileChats(seen, (_, err) => errors.push(err))) out.push(item);
      return out;
    };
    assert.equal((await collect()).length, 2);
    assert.equal((await collect()).length, 0);
    fs.appendFileSync(claude, "\n{}");
    assert.equal((await collect()).length, 0);
    assert.deepEqual(errors, []);
  } finally {
    for (const [key, value] of [["CLAUDE_CONFIG_DIR", previous[0]], ["CODEX_HOME", previous[1]]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
