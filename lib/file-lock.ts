import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// A cross-process lock for read-modify-write on a JSON file (v5.1): the web app and the runner both
// change plans and tasks now (Autopilot runs in the runner). The lock is a file created with O_EXCL that
// holds its owner's token. One older than 15 s belongs to a crashed process: it's taken over by renaming
// it aside (only one contender's rename can win) and checking the token it held — if a live owner had
// replaced it meanwhile, it's put back untouched. Synchronous on purpose: the critical sections are a
// read and a write, a few milliseconds.

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const nap = (ms: number) => Atomics.wait(sleeper, 0, 0, ms);

function stealIfStale(file: string) {
  let seen: string;
  try {
    if (Date.now() - fs.statSync(file).mtimeMs <= 15_000) return;
    seen = fs.readFileSync(file, "utf8");
  } catch {
    return; // released meanwhile
  }
  const aside = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.stale`;
  try {
    fs.renameSync(file, aside);
  } catch {
    return; // someone else moved it first
  }
  try {
    if (fs.readFileSync(aside, "utf8") !== seen) fs.linkSync(aside, file); // a live lock: put it back
  } catch {
    /* the path is taken again — that owner is live, nothing to restore */
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

export function withLock<T>(name: string, fn: () => T): T {
  const dir = path.join(DATA_DIR, "locks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w.-]/g, "_")}.lock`);
  const token = `${process.pid}:${crypto.randomBytes(6).toString("hex")}`;
  const until = Date.now() + 5000;
  for (;;) {
    try {
      fs.writeFileSync(file, token, { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      stealIfStale(file);
      if (Date.now() > until) throw new Error(`${name} is busy — try again`);
      nap(15);
    }
  }
  try {
    return fn();
  } finally {
    // Only remove our own lock (if it was ever taken over, the file now holds someone else's token).
    try {
      if (fs.readFileSync(file, "utf8") === token) fs.rmSync(file, { force: true });
    } catch {
      /* already gone */
    }
  }
}
