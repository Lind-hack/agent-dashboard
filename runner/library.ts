import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { geminiJSON, geminiReady, type InlineImage } from "../lib/gemini";
import { groqJSON, transcribe } from "../lib/groq";
import { addSection, listItems, mediaDir, mirrorItem, readItem, readSections, removeMirror, saveItem, type LibraryItem, type Section } from "../lib/library";

// The Library automation (plan v3 §3): every queued capture is read — voice transcribed, images and
// video frames described, links fetched — then the organiser files it into a section (making a new
// one when nothing fits) and mirrors it as a note into the vault. One item at a time, off the tick.

const run = promisify(execFile);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "library:", ...a);
const MAX_ATTEMPTS = 3;

let busy = false;

export function libraryTick() {
  if (busy) return;
  const now = Date.now();
  const items = listItems();
  // A crash mid-item leaves it "processing"; after 15 minutes it's picked up again.
  const next = items
    .filter((i) => (i.status === "queued" && (!i.nextAt || Date.parse(i.nextAt) <= now)) || (i.status === "processing" && now - Date.parse(i.updatedAt) > 15 * 60_000))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  // Images saved while Gemini wasn't configured get their description once it is (ready ones only —
  // a failed vision pass goes back to "queued" with its backoff like anything else).
  const waiting = !next && geminiReady() ? items.find((i) => i.waiting === "vision" && i.status === "ready") : undefined;
  const it = next ?? waiting;
  if (!it) return;
  busy = true;
  void processItem(it.id)
    .catch((e) => log(it.id, e instanceof Error ? e.message : e))
    .finally(() => (busy = false));
}

async function processItem(id: string) {
  const it = readItem(id);
  if (!it) return;
  it.status = "processing";
  it.attempts = (it.attempts ?? 0) + 1;
  saveItem(it);
  const stamp = it.updatedAt; // anything newer was Lind editing it while we worked
  log("processing", it.id, it.kind);
  try {
    const read = await extract(it);
    const draft: LibraryItem = { ...(readItem(id) ?? it), text: read.text.slice(0, 40_000), waiting: read.waiting };
    if (read.poster) draft.media = { ...draft.media!, poster: read.poster, duration: read.duration ?? draft.media?.duration };
    await organise(draft, read.title);
    // Commit against the item as it is NOW: deleted → drop the result; edited → keep his title/section.
    const fresh = readItem(id);
    if (!fresh) return;
    const edited = fresh.updatedAt !== stamp;
    Object.assign(fresh, {
      text: draft.text,
      media: draft.media,
      waiting: draft.waiting,
      summary: draft.summary,
      tags: draft.tags,
      title: edited ? fresh.title : draft.title,
      section: edited && fresh.section ? fresh.section : draft.section,
      status: "ready",
      error: undefined,
      nextAt: undefined,
    });
    mirrorItem(fresh);
    saveItem(fresh);
    log("ready", fresh.id, fresh.section, fresh.title);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const fresh = readItem(id);
    if (!fresh) return; // deleted meanwhile — nothing to resurrect
    fresh.error = msg.slice(0, 300);
    // Retrying can't fix a refused link or a missing file.
    if ((fresh.attempts ?? 0) >= MAX_ATTEMPTS || /private address|only http|file is missing/.test(msg)) fresh.status = "failed";
    else {
      fresh.status = "queued";
      fresh.nextAt = new Date(Date.now() + 60_000 * 4 ** (fresh.attempts ?? 1)).toISOString();
    }
    saveItem(fresh);
    log("failed", id, msg);
  }
}

type Read = { text: string; title?: string; poster?: string; duration?: number; waiting?: "vision" };

const file = (it: LibraryItem) => path.join(mediaDir(), path.basename(it.media?.file ?? ""));
const withNote = (it: LibraryItem, s: string) => [it.note, s].filter(Boolean).join("\n\n");

async function extract(it: LibraryItem): Promise<Read> {
  if (it.kind !== "text" && it.kind !== "link" && !(it.media?.file && fs.existsSync(file(it)))) throw new Error("the uploaded file is missing");
  switch (it.kind) {
    case "text":
      return { text: it.text };
    case "link":
      return readLink(it);
    case "voice":
    case "audio":
      return { text: withNote(it, await hear(file(it))) };
    case "image":
      return readImage(it);
    case "video":
      return readVideo(it);
    default:
      return readFile(it);
  }
}

// Speech → text: re-encoded to 16 kHz mono Opus first so even long notes stay under Whisper's 25 MB.
async function hear(input: string): Promise<string> {
  const tmp = path.join(os.tmpdir(), `lib-${process.pid}-${Date.now()}.ogg`);
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", tmp], { timeout: 10 * 60_000 });
    const buf = fs.readFileSync(tmp);
    if (buf.length > 25 * 1024 * 1024) throw new Error("audio longer than Whisper takes (about 2 hours)");
    return await transcribe(new Blob([buf], { type: "audio/ogg" }), "note.ogg");
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

type Seen = { title?: string; description?: string; text_in_image?: string };
const VISION = `Describe this for Lind's searchable memory. Return JSON {"title": string (≤8 words), "description": string (2-5 sentences: what it shows, who/what/where, anything notable), "text_in_image": string (all readable text, verbatim, or "")}. Write in English unless the content is clearly Albanian.`;

async function readImage(it: LibraryItem): Promise<Read> {
  if (!geminiReady()) return { text: withNote(it, it.media?.name ?? "image"), waiting: "vision" };
  let img: InlineImage = { mime: it.media?.mime ?? "image/jpeg", data: fs.readFileSync(file(it)) };
  // Big or unusual images go through ffmpeg to a 1600px JPEG.
  if (img.data.length > 12 * 1024 * 1024 || !/image\/(png|jpeg|webp|heic|heif)/.test(img.mime)) img = { mime: "image/jpeg", data: await still(file(it), null, 1600) };
  const seen = await geminiJSON<Seen>(withNote(it, VISION), [img]);
  return { title: seen.title, waiting: undefined, text: [it.note, seen.description, seen.text_in_image ? `Text in the image: ${seen.text_in_image}` : ""].filter(Boolean).join("\n\n") };
}

async function still(input: string, at: number | null, width: number): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `lib-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await run("ffmpeg", ["-y", "-v", "error", ...(at === null ? [] : ["-ss", at.toFixed(2)]), "-i", input, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "3", tmp], { timeout: 120_000 });
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function readVideo(it: LibraryItem): Promise<Read> {
  const input = file(it);
  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", input], { timeout: 60_000 }).catch(() => null);
  const info = JSON.parse(probe?.stdout || "{}") as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const duration = Number(info.format?.duration) || 0;
  const posterName = `${it.id}-poster.jpg`;
  fs.writeFileSync(path.join(mediaDir(), posterName), await still(input, Math.min(1, duration / 2), 960));
  const transcript = info.streams?.some((s) => s.codec_type === "audio") ? await hear(input).catch(() => "") : "";
  if (!geminiReady()) return { text: withNote(it, transcript ? `Said in the video: ${transcript}` : it.media?.name ?? "video"), poster: posterName, duration, waiting: "vision" };
  const frames = await Promise.all([0.15, 0.5, 0.85].map(async (f) => ({ mime: "image/jpeg", data: await still(input, duration * f, 768) })));
  const seen = await geminiJSON<Seen>(withNote(it, `${VISION}\nThese are three frames from one ${Math.round(duration)}-second video, in order.${transcript ? ` What is said in it: ${transcript.slice(0, 3000)}` : ""}`), frames);
  return {
    title: seen.title,
    poster: posterName,
    duration,
    text: [it.note, seen.description, seen.text_in_image ? `Text on screen: ${seen.text_in_image}` : "", transcript ? `Said in the video: ${transcript}` : ""].filter(Boolean).join("\n\n"),
  };
}

async function readFile(it: LibraryItem): Promise<Read> {
  const p = file(it);
  const name = it.media?.name ?? "file";
  if (/\.(txt|md|csv|json|log|ya?ml)$/i.test(name)) return { text: withNote(it, fs.readFileSync(p, "utf8").slice(0, 30_000)) };
  if (it.media?.mime === "application/pdf" && geminiReady() && (it.media?.bytes ?? 0) < 18 * 1024 * 1024) {
    const seen = await geminiJSON<{ title?: string; summary?: string; text?: string }>(
      `Read this PDF for Lind's searchable memory. Return JSON {"title": string, "summary": string (3-6 sentences), "text": string (the key content, up to 6000 characters)}.`,
      [{ mime: "application/pdf", data: fs.readFileSync(p) }],
    );
    return { title: seen.title, text: withNote(it, [seen.summary, seen.text].filter(Boolean).join("\n\n")) };
  }
  return { text: withNote(it, name) };
}

// Is this address on the public internet? (Loopback, private, link-local, CGNAT, multicast and
// unique-local ranges are not — the VPS runs Supabase, the dashboard and more on those.)
function publicIp(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224);
  }
  const x = ip.toLowerCase();
  return !(x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("ff"));
}

async function assertPublic(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) links");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || !ips.every(publicIp)) throw new Error("that link points at a private address");
}

// The page body, at most 1 MB, following up to 4 redirects — each hop checked again.
async function fetchPage(start: URL): Promise<{ html: string; url: URL }> {
  let u = start;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(u);
    const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (AgenticOS memory)" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      await res.body?.cancel();
      u = new URL(loc, u);
      continue;
    }
    if (!res.ok || !/html/.test(res.headers.get("content-type") ?? "") || !res.body) {
      await res.body?.cancel();
      return { html: "", url: u };
    }
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (size < 1_000_000) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    return { html: Buffer.concat(parts).toString("utf8"), url: u };
  }
  throw new Error("too many redirects");
}

const YOUTUBE = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i;

// Videos: the transcript the platform already has (Supadata, mode "native" — never paid generation).
async function videoTranscript(u: URL): Promise<string> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return "";
  const q = new URLSearchParams({ url: u.toString(), text: "true", mode: "native" });
  const res = await fetch(`https://api.supadata.ai/v1/transcript?${q}`, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(60_000) });
  if (res.status !== 200) return ""; // 202 = a long async job; the page's own title/description still go in
  const b = (await res.json().catch(() => null)) as { content?: unknown } | null;
  return typeof b?.content === "string" ? b.content.slice(0, 40_000) : "";
}

// Articles: the page's main content as markdown (Firecrawl), so Memory can search the whole text.
async function articleText(u: URL): Promise<{ title?: string; markdown: string }> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { markdown: "" };
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: u.toString(), formats: ["markdown"], onlyMainContent: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return { markdown: "" };
  const b = (await res.json().catch(() => null)) as { data?: { markdown?: string; metadata?: { title?: string } } } | null;
  return { title: b?.data?.metadata?.title, markdown: (b?.data?.markdown ?? "").slice(0, 40_000) };
}

// Links (v5: full text): YouTube → its transcript; other pages → Firecrawl's main-content markdown.
// The page's own title + description always go in; without the keys it's those plus a text excerpt.
async function readLink(it: LibraryItem): Promise<Read> {
  const url = new URL(it.url ?? "");
  await assertPublic(url);
  const isVideo = YOUTUBE.test(url.hostname);
  const [{ html }, full] = await Promise.all([
    fetchPage(url),
    (isVideo ? videoTranscript(url).then((markdown) => ({ title: undefined, markdown })) : articleText(url)).catch(() => ({ title: undefined, markdown: "" })),
  ]);
  if (full.markdown) {
    const t = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? full.title ?? "";
    const title = t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
    return { title: title || undefined, text: withNote(it, [title, it.url, isVideo ? `Transcript:\n${full.markdown}` : full.markdown].filter(Boolean).join("\n\n")) };
  }
  return readPageMeta(it, html);
}

function readPageMeta(it: LibraryItem, html: string): Read {
  const meta = (re: RegExp) => html.match(re)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const title = decode(meta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || meta(/<title[^>]*>([^<]+)<\/title>/i));
  const desc = decode(meta(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)/i));
  const body = html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
  return { title: title || undefined, text: withNote(it, [title, desc, it.url, body].filter(Boolean).join("\n\n")) };
}

type Filed = { title?: string; summary?: string; tags?: string[]; section?: string | null; new_section?: { name?: string; description?: string } | null };

// The organiser: picks the section, or creates one when nothing fits.
async function organise(it: LibraryItem, suggested?: string) {
  const sections = readSections();
  const list = sections.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join("\n");
  const out = await groqJSON<Filed>(
    `You file one item into Lind's personal memory. Lind is a CS student in Kosovo who runs the @building.ai TikTok (AI/tech), builds the 383 news site, an AI agency and an agent dashboard.
Return JSON {"title": string, "summary": string, "tags": string[], "section": string | null, "new_section": {"name": string, "description": string} | null}.
- title: ≤8 words, specific (names, numbers), in the item's language.
- summary: one or two sentences someone could search for later.
- tags: 2-5 lowercase keywords (people, projects, tools, places).
- section: the id of the best existing section. Only when NONE of them fits, set section null and propose new_section (a short broad name like "Fitness" or "Clients", never one item's title). There are ${sections.length} of max 24 sections${sections.length >= 24 ? " — the limit is reached, pick an existing one" : ""}.
Existing sections:
${list}`,
    `Kind: ${it.kind}${it.media?.name ? ` (${it.media.name})` : ""}${suggested ? `\nSuggested title: ${suggested}` : ""}\n\n${(it.text || it.note || it.title).slice(0, 6000)}`,
    0.2,
    { maxTokens: 600 },
  );
  if (!out) throw new Error("the organiser (Groq) didn't answer — will retry");
  let section: Section | null | undefined = sections.find((s) => s.id === out.section);
  if (!section && out.new_section?.name) {
    section = addSection(out.new_section.name, out.new_section.description ?? "", "core");
    if (section) log("new section", section.name);
  }
  // A title Lind set himself (anything not the automatic placeholder) is kept.
  const auto = !it.title || it.title === "Voice note" || it.title === it.media?.name || it.title === it.kind || (it.kind === "text" && it.text.startsWith(it.title)) || (it.kind === "link" && it.url?.includes(it.title));
  if (auto && typeof out.title === "string" && out.title.trim()) it.title = out.title.trim().slice(0, 120);
  if (typeof out.summary === "string") it.summary = out.summary.trim().slice(0, 600);
  if (Array.isArray(out.tags)) it.tags = out.tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().trim().slice(0, 30)).filter(Boolean).slice(0, 6);
  if (!it.section || !readSections().some((s) => s.id === it.section)) it.section = section?.id ?? sections[0]?.id;
}
