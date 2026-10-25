// Secret detection shared by the PC hand-off/brain scripts (run directly by Node 24 — keep this file
// to erasable TypeScript: types only, no enums/namespaces) and the VPS (tsx / Next).

const PATTERNS: [string, RegExp][] = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["github", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})\b/g],
  ["nvidia", /\bnvapi-[A-Za-z0-9_-]{20,}\b/g],
  ["openai/anthropic", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["groq", /\bgsk_[A-Za-z0-9]{20,}\b/g],
  ["google", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["aws", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["linear", /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["auth-header", /\b(Authorization|Cookie|Set-Cookie|X-Api-Key)(\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?[^\s"'\\]{8,}/gi],
  ["url-credentials", /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@"']+:[^\s@/"']+@/gi],
  [
    "env-assignment",
    /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIALS?|PRIVATE|SESSION|COOKIE|AUTH)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"'`]{8,}\3/g,
  ],
];

// Long random-looking tokens that don't match a known shape.
const HIGH_ENTROPY = /\b[A-Za-z0-9+/_-]{40,}\b/g;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

const looksRandom = (s: string) => entropy(s) > 4.3 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && !/^[0-9a-f]+$/i.test(s);

export type RedactResult = { text: string; hits: Record<string, number> };

// Replaces anything secret-looking with [redacted:<kind>]. Git SHAs and UUIDs (hex) are left alone.
export function redact(input: string): RedactResult {
  const hits: Record<string, number> = {};
  const bump = (k: string) => (hits[k] = (hits[k] ?? 0) + 1);
  let text = input;
  for (const [kind, re] of PATTERNS) {
    text = text.replace(re, (m: string, a?: string, b?: string) => {
      bump(kind);
      if (kind === "auth-header" || kind === "env-assignment") return `${a}${b}[redacted:${kind}]`;
      if (kind === "url-credentials") return `${a}[redacted]@`;
      return `[redacted:${kind}]`;
    });
  }
  text = text.replace(HIGH_ENTROPY, (m: string) => {
    if (!looksRandom(m)) return m;
    bump("high-entropy");
    return "[redacted:token]";
  });
  return { text, hits };
}

// True when a file path itself suggests secrets (.env, keys, credential files).
export function secretPath(p: string): boolean {
  const name = p.split(/[\\/]/).pop() ?? p;
  return (
    /^\.env(\..+)?$/i.test(name) && !/\.(example|sample|template)$/i.test(name)
  ) || /\.(pem|key|p12|pfx|keystore|jks)$/i.test(name) || /^id_(rsa|ed25519|ecdsa|dsa)$/.test(name) || /(credentials|service[-_]?account|secrets?)\.(json|ya?ml)$/i.test(name) || /^(google_token|token|auth)\.json$/i.test(name);
}
