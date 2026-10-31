import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

// A cross-process lock for read-modify-write on a JSON file (v5.1): the web app and the runner both
// change plans and tasks now (Autopilot runs in the runner). The lock is a file created with O_EXCL;
// one older than 15 s belongs to a crashed process and is taken over. Synchronous on purpose — the
// critical sections are a read and a write, a few milliseconds.

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const nap = (ms: number) => Atomics.wait(sleeper, 0, 0, ms);

export function withLock<T>(name: string, fn: () => T): T {
  const dir = path.join(DATA_DIR, "locks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w.-]/g, "_")}.lock`);
  const until = Date.now() + 5000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > 15_000) fs.rmSync(file, { force: true });
      } catch {
        /* released meanwhile */
      }
      if (Date.now() > until) throw new Error(`${name} is busy — try again`);
      nap(15);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}
