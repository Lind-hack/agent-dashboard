import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DATA_DIR } from "./config";

// One owner across runner and web processes. Never hold the synchronous file lock over a request.
// A dead process's lock can be recovered; live processes (including a slow request) keep ownership.
export function tryFileLease(name: string): (() => void) | null {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const lock = path.join(DATA_DIR, `${name.replace(/[^a-zA-Z0-9.-]/g, "_")}.lock`);
  const token = `${process.pid}:${crypto.randomUUID()}`;
  const mine = `${lock}.${token.replace(":", "-")}`;
  fs.writeFileSync(mine, token);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.linkSync(mine, lock);
        return () => { try { if (fs.readFileSync(lock, "utf8") === token) fs.rmSync(lock); } catch { /* already released */ } };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        let seen: string;
        try { seen = fs.readFileSync(lock, "utf8"); } catch { return null; }
        const pid = Number(seen.split(":")[0]);
        if (!pid) return null;
        try { process.kill(pid, 0); return null; }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== "ESRCH") return null; }
        const aside = `${mine}.stale`;
        try {
          fs.renameSync(lock, aside);
          if (fs.readFileSync(aside, "utf8") !== seen) {
            try { fs.linkSync(aside, lock); } catch { /* another owner has it */ }
            return null;
          }
        } catch { return null; }
        finally { fs.rmSync(aside, { force: true }); }
      }
    }
    return null;
  } finally { fs.rmSync(mine, { force: true }); }
}

