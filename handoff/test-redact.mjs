#!/usr/bin/env node
// Redaction cases: `node handoff/test-redact.mjs` (Node 24 runs the .ts directly). Exit 1 on any failure.
// handoff-scan: fake-secrets-only — every secret below is made up (the hand-off scanner skips this file).
import { redact, secretPath } from "../lib/redact.ts";

const secrets = [
  "nvapi-FAKEfake0123456789abcdefGHIJKLmnopqrSTUVwxyz_0123456789abcdEFG",
  "token github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123",
  "GROQ_API_KEY=gsk_abcdefghijklmnopqrstuvwxyz012345",
  "Authorization: Bearer abcdef1234567890xyz",
  "https://user:hunter2pass@example.com/x",
  "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
  "x Q2hlY2tPdXRUaGlzVmVyeUxvbmdSYW5kb21Ub2tlbjEyMzQ1Njc4OTBhYmNk y",
  "DASHBOARD_PASSWORD=correct-horse-battery",
];
const keep = [
  "commit 5728b22e6f0a1c9d3b4e5f60718293a4b5c6d7e8 merged",
  "session deff5783-7772-446f-bc1b-f538b127c65b",
  "The Bota index uses a v4 rescore conversion for every article published today.",
  "/c/Users/PC1/Desktop/claude/agent-dashboard/components/memory-view.tsx",
  String.raw`C:\Users\PC1\Desktop\claude\agent-dashboard\components\memory-view.tsx`,
  "Desktop/claude/383/app/api/automation/tregu/live-sports/route.ts",
  "-var-lib-agent-dashboard-work-wt-H-6ADE21A8-claude-projects-folder-name",
];
const paths = [
  [".env", true],
  [".env.local", true],
  [".env.example", false],
  ["id_ed25519", true],
  ["certs/server.pem", true],
  ["tools/google_token.json", true],
  ["lib/redact.ts", false],
  ["package.json", false],
];

let bad = 0;
for (const s of secrets) if (redact(s).text === s) (bad++, console.log("missed:", s));
for (const s of keep) if (redact(s).text !== s) (bad++, console.log("false positive:", s, "->", redact(s).text));
for (const [p, want] of paths) if (secretPath(p) !== want) (bad++, console.log("path:", p, "expected", want));
console.log(bad ? `${bad} failure(s)` : `all ${secrets.length + keep.length + paths.length} redaction cases pass`);
process.exit(bad ? 1 : 0);
