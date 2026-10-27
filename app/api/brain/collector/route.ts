import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The PC scripts as deployed with this build. The installed collector on the PC (~/.agent-dashboard,
// Bearer HANDOFF_TOKEN) fetches them each run and swaps in what changed, so updating the dashboard never
// needs a command on the PC. Fixed list — nothing else in the app is readable this way.
const FILES: Record<string, string> = {
  "brain-collect.mjs": "handoff/brain-collect.mjs",
  "handoff.mjs": "handoff/handoff.mjs",
  "takeback.mjs": "handoff/takeback.mjs",
  "sync-notes.mjs": "handoff/sync-notes.mjs",
  "google-auth.mjs": "handoff/google-auth.mjs",
  "redact.ts": "lib/redact.ts",
  "transcript.ts": "lib/transcript.ts",
};

export async function GET() {
  const files: Record<string, string> = {};
  for (const [name, rel] of Object.entries(FILES)) {
    try {
      files[name] = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
    } catch {
      /* not in this build */
    }
  }
  if (!files["brain-collect.mjs"]) return NextResponse.json({ error: "collector not found in this build" }, { status: 500 });
  return NextResponse.json({ build: process.env.COMMIT_SHA ?? null, files });
}
