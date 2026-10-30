import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invalidateMemory, vaultDir } from "./memory";

export type CaptureKind = "article" | "video";

export type CaptureResult =
  | { ok: true; file: string; title: string; kind: CaptureKind; via: string; duplicate?: boolean }
  | { ok: false; error: string };

type Captured = { title: string; text: string; kind: CaptureKind; via: string; channel?: string };

const MAX_TEXT = 400_000;
const UA = "Mozilla/5.0 (compatible; agent-dashboard/1.0)";

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";

const rawInbox = () => path.join(vaultDir(), "raw", "inbox");

function publicUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1") return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  if (host.includes(":") && /^(fc|fd|fe80|::)/.test(host)) return null;
  return u;
}

function videoUrl(u: URL): boolean {
  return /(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.watch)$/i.test(u.hostname);
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const valid = (id: string) => (/^[\w-]{11}$/.test(id) ? id : null);
  if (host === "youtu.be") return valid(u.pathname.slice(1).split("/")[0]);
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v");
    if (v) return valid(v);
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function canonical(u: URL): string {
  const id = youtubeId(u);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const clean = new URL(u.toString());
  clean.hash = "";
  for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "si", "feature"]) clean.searchParams.delete(p);
  return clean.toString();
}

function findExisting(url: string): string | null {
  const root = vaultDir();
  for (const rel of ["raw/inbox", "raw/processed", "raw/sources"]) {
    const dir = path.join(root, rel);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const head = fs.readFileSync(path.join(dir, name), "utf8").slice(0, 4000);
        const m = head.match(/^(?:source|source_url|url):\s*["']?([^"'\n]+?)["']?\s*$/m);
        if (m && m[1].trim() === url) return path.relative(root, path.join(dir, name)).replace(/\\/g, "/");
      } catch {
        continue;
      }
    }
  }
  return null;
}

function writeNote(cap: Captured, url: string): string {
  const dir = rawInbox();
  const date = new Date().toISOString().slice(0, 10);
  const base = `${date} ${slug(cap.title || new URL(url).hostname)}`;
  let file = path.join(dir, `${base}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.md`);
  const text = cap.text.trim();
  const heading = /^#\s/.test(text) ? "" : `# ${cap.title}\n\n`;
  const md = [
    "---",
    `title: ${JSON.stringify(cap.title)}`,
    `source: ${JSON.stringify(url)}`,
    `source_url: ${JSON.stringify(url)}`,
    `type: ${cap.kind}`,
    `capture_tool: ${cap.via}`,
    `captured_at: ${new Date().toISOString()}`,
    ...(cap.channel ? [`youtube_channel: ${JSON.stringify(cap.channel)}`] : []),
    "tags: [clipped, inbox]",
    "---",
    "",
    heading + text,
    "",
  ].join("\n");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, md);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(
      code === "EACCES" || code === "EPERM"
        ? "The vault's raw/inbox isn't writable by the dashboard. Run deploy/vault-access.sh on the VPS."
        : `Couldn't write the note: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return path.relative(vaultDir(), file).replace(/\\/g, "/");
}

export async function readSource(input: string): Promise<CaptureResult> {
  const u = publicUrl(input);
  if (!u) return { ok: false, error: "Paste a public http(s) link." };
  const url = canonical(u);
  const existing = findExisting(url);
  if (existing) return { ok: true, file: existing, title: "", kind: videoUrl(u) ? "video" : "article", via: "existing", duplicate: true };
  try {
    const cap = videoUrl(u) ? await captureVideo(url) : await captureArticle(url);
    const file = writeNote(cap, url);
    invalidateMemory();
    return { ok: true, file, title: cap.title, kind: cap.kind, via: cap.via };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function captureArticle(url: string): Promise<Captured> {
  const firecrawl = await viaFirecrawl(url);
  if (firecrawl) return { ...firecrawl, kind: "article", via: "firecrawl" };
  const local = await viaFetch(url);
  return { ...local, kind: "article", via: "fetch" };
}

async function viaFirecrawl(url: string): Promise<{ title: string; text: string } | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const base = (process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev").replace(/\/$/, "");
    const res = await fetch(`${base}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { data?: { markdown?: string; metadata?: { title?: string } } } | null;
    const text = body?.data?.markdown?.trim();
    if (!text) return null;
    return { title: body?.data?.metadata?.title?.trim() || url, text };
  } catch {
    return null;
  }
}

async function viaFetch(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`The page returned ${res.status}.`);
  const type = res.headers.get("content-type") ?? "";
  const body = (await res.text()).slice(0, 2_000_000);
  if (type.includes("text/plain")) return { title: new URL(url).hostname, text: body.slice(0, MAX_TEXT) };
  if (!type.includes("html") && !type.includes("xml")) throw new Error("That URL isn't an HTML article.");
  const out = htmlToMarkdown(body);
  if (out.text.length < 200) throw new Error("Couldn't extract readable text from that page.");
  return { title: out.title || new URL(url).hostname, text: out.text.slice(0, MAX_TEXT) };
}

async function captureVideo(url: string): Promise<Captured> {
  const meta = youtubeId(new URL(url)) ? await oembed(url) : { title: new URL(url).hostname };
  const captions = ytdlp(url);
  if (captions) return { title: meta.title || "Video", text: captions.slice(0, MAX_TEXT), kind: "video", via: "yt-dlp", channel: meta.channel };
  const supadata = await viaSupadata(url);
  if (supadata) return { title: meta.title || "Video", text: supadata.slice(0, MAX_TEXT), kind: "video", via: "supadata", channel: meta.channel };
  throw new Error("No transcript found. Install yt-dlp on the VPS or set SUPADATA_API_KEY.");
}

async function oembed(url: string): Promise<{ title: string; channel?: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { title: "" };
    const body = (await res.json()) as { title?: string; author_name?: string };
    return { title: body.title?.trim() ?? "", channel: body.author_name?.trim() };
  } catch {
    return { title: "" };
  }
}

function ytdlp(url: string): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "read-capture-"));
  try {
    execFileSync(
      "yt-dlp",
      [
        "--no-warnings",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en.*,en,sq.*,sq",
        "--sub-format",
        "vtt",
        "--convert-subs",
        "vtt",
        "-o",
        path.join(dir, "%(id)s.%(ext)s"),
        url,
      ],
      { stdio: "ignore", timeout: 90_000 },
    );
    const vtt = fs.readdirSync(dir).find((f) => f.endsWith(".vtt"));
    if (!vtt) return null;
    const text = vttToText(fs.readFileSync(path.join(dir, vtt), "utf8"));
    return text || null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function viaSupadata(url: string): Promise<string | null> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return null;
  const base = "https://api.supadata.ai/v1/transcript";
  try {
    const res = await fetch(`${base}?url=${encodeURIComponent(url)}&text=true`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 202) {
      const job = (await res.json().catch(() => null)) as { jobId?: string } | null;
      if (!job?.jobId) return null;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        const poll = await fetch(`${base}/${encodeURIComponent(job.jobId)}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30_000) });
        const body = (await poll.json().catch(() => null)) as { content?: string; text?: string; status?: string } | null;
        const text = body?.content ?? body?.text;
        if (text?.trim()) return text.trim();
        if (poll.status !== 202) break;
      }
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { content?: string; text?: string } | null;
    const text = body?.content ?? body?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

function vttToText(vtt: string): string {
  const out: string[] = [];
  for (const line of vtt.replace(/\r/g, "").split("\n")) {
    if (!line.trim() || line.startsWith("WEBVTT") || line.includes("-->")) continue;
    if (/^(NOTE|STYLE|REGION|Kind:|Language:)/.test(line) || /^\d+$/.test(line)) continue;
    const text = decodeEntities(line.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text && out[out.length - 1] !== text) out.push(text);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

function htmlToMarkdown(html: string): { title: string; text: string } {
  const title = decodeEntities(
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+name=["']twitter:title["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      "",
  ).trim();
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<head\b[\s\S]*?<\/head>/gi, "")
      .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, "")
      .replace(/<(br|hr)\s*\/?>/gi, "\n\n")
      .replace(/<\/(p|div|section|article|main|h[1-6]|tr|blockquote|pre)>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => `[${label.replace(/<[^>]+>/g, "").trim()}](${href})`)
      .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, "![$1]($2)")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/^[ \t]+/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { title, text };
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return named[e.toLowerCase()] ?? m;
  });
}
