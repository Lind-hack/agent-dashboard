# LIN-955 — A better way to capture articles and video transcripts

**Status:** research / recommendation
**Date:** 2026-10-30
**Scope:** how Lind captures the articles and videos he learns from into the Obsidian vault (`Lind Brain`), and whether a different tool or workflow is faster, more accurate, or more reliable.

---

## TL;DR

Keep the Obsidian Web Clipper as the one-click button, but stop making it the only way in.

Recommended setup — **two lanes, one inbox**:

1. **Articles:** [Firecrawl](https://firecrawl.dev) (cloud free tier, or self-hosted) → clean Markdown → `raw/inbox/`.
2. **Video:** `yt-dlp` captions first, [Supadata](https://supadata.ai) as the paid fallback for TikTok / Instagram / X, Groq Whisper as the last resort.

Both lanes write the same frontmatter and go through one dedupe/index step before the existing `AGENTS.md` ingest workflow turns them into `wiki/` pages. This keeps the vault and the brain as the single source of truth, costs $0 at Lind's current volume, and removes the two real failure modes: re-clipping the same page (18 duplicate notes already in `raw/`) and manually downloading/transcribing every non-YouTube video.

If the real pain is **reading and triage**, not capture, [Readwise Reader](https://readwise.io/read) is the lowest-effort managed option (articles + YouTube transcripts + native full-text Obsidian export) for $9.99/month. If ownership matters more than polish, [Karakeep](https://karakeep.app) is the self-hosted equivalent.

---

## 1. What "the Obsidian scraper" is today

The audit is based on the live vault on the VPS (`MEMORY_VAULT_DIR`, `/var/lib/agent-dashboard/vault`) and the skills installed on the PC.

| Layer | What is used now | Where it lives |
|---|---|---|
| Article capture | **Obsidian Web Clipper** browser extension, six folder templates | `000 - Claude Context/Web Clipper Templates.md` |
| YouTube capture | Web Clipper (transcript extraction + Reader mode; 1.4 made transcripts interactive) or an agent pulling the transcript | same, plus `AGENTS.md` |
| Instagram / TikTok | `video-analyze` / watch-video pipeline: `yt-dlp` → `ffmpeg` → Groq Whisper | `~/.claude/skills/video-analyze/`, `tools/transcribe.py` |
| Filing / synthesis | Agent follows `AGENTS.md`: `raw/` → `wiki/sources/`, concepts, entities, `log.md` | vault `AGENTS.md` |
| VPS side | `runner/brain.ts` reads the vault and appends chat/commit/graph pages | this repo |

### Measured state (2026-10-30)

| Metric | Value |
|---|---|
| Markdown files under `raw/` | 89 |
| Files in `raw/processed/` | 84 |
| Files waiting in `raw/inbox/` | 1 |
| Generated pages in `wiki/sources/` | 13 |
| Notes with a `source:` / `source_url:` / `url:` field | 83 / 89 |
| Notes with `youtube_channel` | 13 |
| Files explicitly named "duplicate re-clip" | 18 |

Representative current note:

```yaml
---
title: "The Last AI Roadmap Video You’ll Ever Watch"
source: "https://www.youtube.com/watch?v=KjKlBvX9G7w"
author:
  - "[[Nick Saraev]]"
published: 2026-10-16
created: 2026-10-26
tags:
  - "WebClip"
---
```

### Where it breaks

- **One page at a time, by hand.** There is no batch or queue. A 40-minute video and a 5-minute article cost the same amount of Lind's attention.
- **Duplicates are already real.** 18 notes are explicitly duplicate re-clips; the same URL can land twice because nothing checks the canonical URL before writing.
- **YouTube extraction is a moving target.** Web Clipper's transcript support works, but the YouTube DOM/InnerTube path changes (the February 2026 transcript UI change broke community templates), auto-dubbed videos can save the English track instead of the spoken language (clipper issues #957, #991), and the template `properties` bug (#954) can silently drop metadata.
- **IG / TikTok are expensive.** No native transcript API, so the pipeline downloads the whole video and runs ASR. That is slow, data-heavy, and blocked by platforms from datacenter IPs.
- **No shared index.** Nothing knows what has already been captured, when, by which tool, or whether the page changed.
- **No fallback.** If the page is JS-heavy, behind a consent wall, or the transcript panel fails, the capture is thin or empty and nobody notices until ingest.

---

## 2. Alternatives

### Option A — Readwise Reader (managed read-it-later + Obsidian export)

Reader saves articles, newsletters, PDFs, RSS, and YouTube links into one triage inbox. YouTube videos get a time-synced transcript (native captions, with an optional AI-enhanced version) that can be highlighted like an article. The Readwise → Obsidian integration can export **full document text**, not only highlights, with Jinja-style templates and YAML frontmatter.

- **Speed:** instant save from browser/mobile; transcript is fetched server-side in the background.
- **Accuracy:** native captions when available; AI-enhanced transcript fixes punctuation and paragraphs. The docs are explicit that auto-generated captions are still the base, so proper nouns can be wrong.
- **Integration:** lowest effort. Install the extension, connect Obsidian, toggle "Export All Reader Documents".
- **Storage:** the canonical copy lives in Readwise's cloud; Obsidian gets exported Markdown. That is a second copy and a vendor dependency.
- **Cost:** $9.99/month (~$120/year).
- **Best for:** Lind if he wants to *read and triage* on phone/desktop, not just archive.

### Option B — Karakeep (self-hosted "bookmark everything")

Karakeep (formerly Hoarder) is an open-source, Docker-first bookmark/read-it-later app: browser and mobile clients, full-page archival with `monolith`, automatic video archiving with `yt-dlp`, AI tagging/summaries (local Ollama supported), full-text and semantic search, REST API, CLI, webhooks, and an official Obsidian sync plugin.

- **Speed:** one click/mobile share; fetching and tagging happen in the background.
- **Accuracy:** article extraction is good; video support is **archiving**, not transcript extraction, so pair it with Supadata/`yt-dlp` if the text is what matters.
- **Integration:** medium. One Docker Compose stack (web + workers + browser + storage + optional Ollama), then the Obsidian plugin or API.
- **Storage:** Postgres/SQLite + asset store; Obsidian gets synced Markdown. The vault is no longer the only copy.
- **Cost:** $0 software; you pay VPS RAM/disk (the browser worker is the heavy part).
- **Best for:** Lind if he wants a private, self-hosted reading UI and is willing to run another service.

### Option C — Scripted extractors: Firecrawl + `yt-dlp` / Supadata (recommended)

A small command (run from the PC, the VPS, or an agent skill) takes one or more URLs, detects article vs video, extracts text, and writes a normal vault note.

- **Articles:** Firecrawl `/v2/scrape` returns LLM-ready Markdown, renders JavaScript, strips nav/footer, and has a 1,000-page/month free tier. Self-hosting is possible with Docker Compose. Local fallback: `trafilatura` (rule-based + readability/jusText fallback; ~0.91 F1 on the standard article-extraction benchmark) or Jina Reader (`https://r.jina.ai/<url>`).
- **YouTube:** `yt-dlp --write-auto-subs --write-subs` gets native captions in seconds without downloading the video.
- **TikTok / Instagram / X / Facebook:** Supadata's `/v1/transcript` endpoint uses native captions when present and AI transcription otherwise; 100 free credits/month, then paid. This is the piece `yt-dlp` cannot reliably do from a server.
- **Last resort:** Groq Whisper (already used by `video-analyze`).

- **Speed:** seconds per item; batchable; no browser needed.
- **Accuracy:** Firecrawl is strong on JS/SPA pages; native captions are exact; Supadata claims >95% on clear audio; Whisper is good but slower and weaker on names.
- **Integration:** highest initial work (one script + keys), but it fits the existing vault, brain, and agent workflow with no new UI.
- **Storage:** pure Markdown in `raw/inbox/` — exactly the format `AGENTS.md` already expects.
- **Cost:** $0 at current volume (Firecrawl free tier + Supadata free tier + `yt-dlp`); $19/month if article volume passes 1,000/month.
- **Best for:** this setup. It is the only option that keeps Obsidian as the source of truth and automates both media types.

### Option D — Fully local: `trafilatura` + `yt-dlp` + `faster-whisper`

Same shape as Option C, with no cloud APIs at all: `trafilatura` for articles, `yt-dlp` for captions, `faster-whisper` for audio.

- **Speed:** fast for static articles and captioned YouTube; slow for uncaptioned video.
- **Accuracy:** good on news/blog articles; `trafilatura` is weaker on forums, Q&A, and heavily obfuscated pages; Whisper quality depends on the model size.
- **Integration:** medium; Python venv + model download + more maintenance.
- **Storage:** Markdown in the vault.
- **Cost:** $0, but CPU/GPU time and disk.
- **Best for:** privacy or offline use. Not worth it as the primary when Firecrawl's free tier covers Lind's volume.

### Baseline+ — keep Web Clipper, fix the template

Web Clipper is not obsolete. Its `defuddle` YouTube extractor now fetches captions through InnerTube and exposes `{{transcript}}`; Reader mode and 1.4's interactive transcript make it genuinely good for one-off clips. The cheap upgrade is:

- add a YouTube template that writes `{{transcript}}` and `{{author}}`/`{{published}}`;
- add `source`, `captured_at`, `capture_tool`, and `content_hash` properties to every template;
- stop clipping duplicates by checking the URL index first.

This alone fixes the metadata and dedupe problems, but not batch, JS-heavy pages, or IG/TikTok.

---

## 3. Comparison against the current setup

Scores are relative to the current Web Clipper + agent ingest baseline.

| | Current | Baseline+ (fixed template) | Readwise Reader | Karakeep | **Firecrawl + yt-dlp/Supadata** | Local trafilatura + Whisper |
|---|---|---|---|---|---|---|
| **Speed per item** | ~5–20 s manual | ~5 s manual | ~2 s save, transcript async | ~2 s save, async | ~2–10 s scripted | ~2–10 s article; ~real-time video |
| **Batch / queue** | No | No | Yes (inbox) | Yes (inbox) | **Yes (CLI list)** | Yes (CLI list) |
| **Article accuracy** | Good, page-dependent | Good | Good | Good | **Very good (JS rendering)** | Good on news/blogs |
| **YouTube transcript** | Good (1.4+) | Good | **Very good + enhanced** | Archive only | **Native captions, exact** | Native captions |
| **IG / TikTok transcript** | Manual download + ASR | Manual | No (Reader is article/YouTube-first) | Archive only | **Yes (Supadata)** | Manual download + ASR |
| **Ease of integration** | Already done | Very easy | **Easiest** | Medium (Docker) | Medium (script + keys) | Medium (venv + models) |
| **Storage format** | Markdown in vault | Markdown in vault | Markdown export (cloud master) | Markdown sync (DB master) | **Markdown in vault** | Markdown in vault |
| **Dedupe / index** | None | URL check only | Built-in library | Built-in library | **Own index, trivial** | Own index |
| **Cost at current volume** | $0 | $0 | $120/yr | $0 + VPS | **$0 (free tiers)** | $0 + compute |
| **Reliability / maintenance** | Breaks when sites/YouTube change | Same | Vendor-managed | You run the stack | **Low; retries + fallbacks** | You maintain models |
| **Vendor lock-in** | None | None | Medium | Low | Low | None |

---

## 4. Recommendation

**Adopt Option C as the primary capture path, keep Web Clipper as the manual button, and only add Reader or Karakeep if the bottleneck turns out to be reading/triage rather than capture.**

Reasons:

1. **It preserves the architecture Lind already built.** The vault is the source of truth, `AGENTS.md` defines the ingest contract, and `runner/brain.ts` already writes into the same vault. Reader and Karakeep would each add a second master copy and a sync step.
2. **It fixes the actual failures.** URL-based dedupe removes the 18-duplicate problem; a script removes per-item manual work; Supadata removes the IG/TikTok download-and-transcribe bottleneck; Firecrawl handles the JS-heavy pages Web Clipper flattens.
3. **It is free at Lind's volume.** Firecrawl gives 1,000 pages/month free; Supadata gives 100 transcripts/month free; `yt-dlp` and Groq cover the rest. The paid step only starts above ~1,000 articles/month or ~100 non-YouTube videos/month.
4. **It is testable.** Each lane has a deterministic output (Markdown + frontmatter), so migration and verification are countable, not vibes.

**When to choose differently:**

- **Readwise Reader** if Lind wants to read on his phone, highlight, and have a daily review loop, and is happy to pay $9.99/month and let Readwise hold the master copy. It has the best YouTube reading experience of any option.
- **Karakeep** if he wants a private reading UI and is willing to run one more Docker stack on the VPS. Pair it with Supadata for transcripts.
- **Local-only** if privacy or offline use becomes a hard requirement.

---

## 5. Implementation

### 5.1 Keys and config

Put these in the existing secrets location, not in the repo:

```bash
# PC: ~/.config/read-collect.env   |   VPS: /etc/agent-dashboard.env
FIRECRAWL_API_KEY=fc-...
SUPADATA_API_KEY=...
GROQ_API_KEY=...            # already present for Whisper
MEMORY_VAULT_DIR=/path/to/Lind Brain
```

`FIRECRAWL_API_URL` is optional and only needed for a self-hosted instance.

### 5.2 Article lane

Firecrawl cloud (one page, Markdown only):

```bash
curl -sS https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/post","formats":["markdown"],"onlyMainContent":true}' \
  | jq -r '.data.markdown' > /tmp/post.md
```

Firecrawl returns `data.markdown` and `data.metadata` (title, `sourceURL`, description). One credit per page; failed scrapes with no result are not charged.

Self-hosted (if Lind would rather not depend on the cloud):

```bash
git clone https://github.com/firecrawl/firecrawl.git
cd firecrawl
docker compose up --build -d
# API is on http://localhost:3002; set FIRECRAWL_API_URL to it
```

Local fallback:

```bash
pipx install trafilatura
trafilatura -u "https://example.com/post" --markdown --with-metadata --no-comments > /tmp/post.md
```

Last-resort no-key fallback:

```bash
curl -sS "https://r.jina.ai/https://example.com/post" > /tmp/post.md
```

### 5.3 Video lane

YouTube — captions first, no video download:

```bash
yt-dlp --skip-download \
  --write-subs --write-auto-subs \
  --sub-langs "en.*,sq.*" --sub-format vtt --convert-subs vtt \
  -o "/tmp/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=VIDEO_ID"
# transcript: /tmp/VIDEO_ID.en.vtt
```

Metadata for the note:

```bash
yt-dlp --skip-download --dump-single-json "URL" \
  | jq '{id, title, channel, upload_date, duration, webpage_url}'
```

Any platform — Supadata (native captions or AI fallback):

```bash
curl -sS "https://api.supadata.ai/v1/transcript?url=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "URL")&text=true" \
  -H "x-api-key: $SUPADATA_API_KEY"
# 200 -> {"content":"..."} ; 202 -> poll /v1/transcript/{jobId}
```

Last resort — Whisper via Groq (already wired in `lib/groq.ts` and `video-analyze`):

```bash
yt-dlp -x --audio-format mp3 -o "/tmp/%(id)s.%(ext)s" "URL"
# then upload /tmp/VIDEO_ID.mp3 to the existing transcription route/tool
```

### 5.4 Reference `read-collect` script

Dependency-free Node 20+. It does not replace the agent's judgment — it only guarantees that what reaches `raw/inbox/` has a URL, a type, a hash, and no duplicate.

```js
#!/usr/bin/env node
// read-collect.mjs <url...>
// Article -> Firecrawl, then trafilatura, then Jina Reader.
// Video   -> yt-dlp captions, then Supadata. Writes one Markdown note per URL.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VAULT = process.env.MEMORY_VAULT_DIR;
if (!VAULT) throw new Error("MEMORY_VAULT_DIR is not set");
const INBOX = path.join(VAULT, "raw", "inbox");
const INDEX = path.join(VAULT, "raw", "index.json");
const key = process.env.FIRECRAWL_API_KEY;
const supadata = process.env.SUPADATA_API_KEY;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "untitled";
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
const isVideo = (u) => /youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com/.test(u);

function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, "utf8")); } catch { return {}; }
}

async function article(url) {
  if (key) {
    const res = await fetch(`${process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev"}/v2/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
    const body = await res.json();
    if (res.ok && body?.data?.markdown) {
      return { title: body.data.metadata?.title || url, text: body.data.markdown, tool: "firecrawl" };
    }
  }
  try {
    const text = execFileSync("trafilatura", ["-u", url, "--markdown", "--no-comments"], { encoding: "utf8" });
    return { title: url, text, tool: "trafilatura" };
  } catch {
    const text = await (await fetch(`https://r.jina.ai/${url}`)).text();
    return { title: url, text, tool: "jina" };
  }
}

async function video(url) {
  try {
    const dir = fs.mkdtempSync("/tmp/read-collect-");
    execFileSync("yt-dlp", ["--skip-download", "--write-subs", "--write-auto-subs",
      "--sub-langs", "en.*,sq.*", "--sub-format", "vtt", "--convert-subs", "vtt",
      "-o", path.join(dir, "%(id)s.%(ext)s"), url], { stdio: "ignore" });
    const vtt = fs.readdirSync(dir).find((f) => f.endsWith(".vtt"));
    if (vtt) {
      const text = fs.readFileSync(path.join(dir, vtt), "utf8")
        .replace(/^WEBVTT.*$/m, "").replace(/^\d\d:\d\d.*$/gm, "").replace(/<[^>]+>/g, "")
        .split("\n").map((l) => l.trim()).filter(Boolean)
        .filter((l, i, a) => l !== a[i - 1]).join(" ");
      return { title: vtt, text, tool: "yt-dlp" };
    }
  } catch { /* fall through */ }
  if (supadata) {
    const res = await fetch(`https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true`, {
      headers: { "x-api-key": supadata },
    });
    const body = await res.json();
    if (res.ok && body?.content) return { title: url, text: String(body.content), tool: "supadata" };
  }
  throw new Error(`no transcript path for ${url}`);
}

for (const url of process.argv.slice(2)) {
  const index = readIndex();
  if (index[url]) { console.log(`skip (already captured): ${url}`); continue; }
  const got = isVideo(url) ? await video(url) : await article(url);
  const title = got.title || url;
  const id = hash(url + got.text);
  const file = path.join(INBOX, `${new Date().toISOString().slice(0, 10)} ${slug(title)} ${id}.md`);
  fs.mkdirSync(INBOX, { recursive: true });
  fs.writeFileSync(file, `---
title: ${JSON.stringify(title)}
source: ${JSON.stringify(url)}
type: ${isVideo(url) ? "video" : "article"}
capture_tool: ${got.tool}
captured_at: ${new Date().toISOString()}
content_hash: ${id}
tags: [clipped]
---

# ${title}

${got.text}
`);
  index[url] = { file: path.relative(VAULT, file), title, tool: got.tool, at: new Date().toISOString() };
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));
  console.log(`saved ${file}`);
}
```

Usage:

```bash
node read-collect.mjs "https://example.com/post" "https://www.youtube.com/watch?v=VIDEO_ID"
```

### 5.5 Web Clipper template fixes

Add to every template's `properties` (if the installed version still writes them — see clipper issue #954):

```json
[
  { "name": "source", "value": "{{url}}", "type": "text" },
  { "name": "captured_at", "value": "{{date}}", "type": "date" },
  { "name": "capture_tool", "value": "web-clipper", "type": "text" }
]
```

YouTube template body (uses the built-in transcript variable):

```json
{
  "schemaVersion": "0.1.0",
  "name": "YouTube → vault",
  "behavior": "create",
  "triggers": ["https://www.youtube.com/watch"],
  "noteNameFormat": "{{date:YYYYMMDD}} {{title|safe_name}}",
  "path": "raw/inbox",
  "properties": [
    { "name": "source", "value": "{{url}}", "type": "text" },
    { "name": "youtube_channel", "value": "{{author}}", "type": "text" },
    { "name": "published", "value": "{{published}}", "type": "date" }
  ],
  "noteContentFormat": "# {{title}}\n\n> {{author}} · {{published}}\n\n## Description\n\n{{description}}\n\n## Transcript\n\n{{transcript}}"
}
```

If `{{transcript}}` is empty on the installed version, the older selector path still works but must be kept in sync with YouTube's UI; prefer upgrading Web Clipper over maintaining selectors.

### 5.6 Scheduling

- **PC:** run `read-collect` from a URL list on demand, or add it to the existing 2-hour Task Scheduler job next to `brain-collect.mjs`.
- **VPS:** a systemd timer is enough; it only needs `MEMORY_VAULT_DIR`, the keys, `yt-dlp`, and Node.

Do **not** run the collector and `brain-collect` against the same vault at the same time — both write files; the existing atomic-write pattern in `runner/brain.ts` is the model to copy.

---

## 6. Migrating the existing scraped data

The migration is additive. Do not rename or delete anything until the index is built and the counts reconcile.

### Step 1 — Snapshot

```bash
cd "$MEMORY_VAULT_DIR"
tar -czf "/tmp/lind-brain-raw-$(date +%F).tgz" raw wiki log.md index.md
```

### Step 2 — Build a URL index from what exists

83 of 89 raw notes already have a URL. Read `source`, `source_url`, or `url` from frontmatter (and the `Source:` link in the body as a fallback), normalize it (lowercase host, strip `www.`, strip tracking params, strip trailing slash), and write `raw/index.json`.

```js
// scripts/build-raw-index.mjs — run once, then keep it updated by read-collect
import fs from "node:fs";
import path from "node:path";

const vault = process.env.MEMORY_VAULT_DIR;
const root = path.join(vault, "raw");
const out = {};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
});

for (const file of walk(root)) {
  const text = fs.readFileSync(file, "utf8");
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const raw = fm.match(/^(?:source|source_url|url):\s*"?([^"\n]+)"?/m)?.[1]
    ?? text.match(/^> \*\*Source:\*\*.*\((https?:\/\/[^)]+)\)/m)?.[1];
  if (!raw) continue;
  const u = new URL(raw);
  u.hash = "";
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "si"]) u.searchParams.delete(k);
  const key = u.toString().replace(/\/$/, "");
  (out[key] ??= []).push(path.relative(vault, file));
}

fs.writeFileSync(path.join(root, "index.json"), JSON.stringify(out, null, 2));
console.log(`${Object.keys(out).length} unique URLs, ${Object.values(out).flat().length} files`);
```

### Step 3 — Resolve duplicates

For each URL with more than one file:

1. Keep the file that is **not** named `(duplicate re-clip …)`; if all are duplicates, keep the oldest by `created:`.
2. Compare `content_hash` (or a normalized-body hash) to confirm they are really the same source.
3. Move the losers to `raw/processed/duplicates/` and add a one-line pointer in the kept note:
   `Duplicate of [[raw/processed/<kept>]] (merged YYYY-MM-DD).`
4. Never delete. The vault's `AGENTS.md` treats `raw/` as append-only.

Expected: 18 duplicate files collapse to 18 pointers, not 18 deletions.

### Step 4 — Normalize only the metadata that matters

Do not rewrite bodies or existing frontmatter wholesale. Backfill, in place:

| Missing field | Source |
|---|---|
| `source` | existing `source`/`url`, or the body `Source:` link |
| `type` | `video` for YouTube/TikTok/IG/X, otherwise `article` |
| `capture_tool` | `web-clipper` for old `WebClip` notes, `manual` otherwise |
| `captured_at` | existing `created:` or file mtime |
| `content_hash` | SHA-256 of the body, first 16 hex chars |
| `youtube_channel` | `yt-dlp --print channel` or oEmbed for YouTube notes missing it |

### Step 5 — Verify before switching

- `raw/index.json` unique URL count + duplicate count reconciles with the file count.
- No file in `raw/` is unreachable from the index unless it intentionally has no URL (count them and list them).
- `grep -c "youtube_channel"` on YouTube notes equals the number of YouTube notes.
- Spot-check 10 random notes: title, URL, transcript/article body all present.
- Open 5 `wiki/sources/` pages and confirm their `raw_path` links still resolve.

### Step 6 — Switch over

1. Run `read-collect` on 10 new URLs; confirm they land in `raw/inbox/` with the new frontmatter.
2. Run the normal `AGENTS.md` ingest on those 10; confirm `wiki/sources/` pages and `log.md` entries are created.
3. Keep Web Clipper installed, but point its templates at `raw/inbox/` and the new properties.
4. Leave old notes where they are. The index is the migration; the files do not need to move.

---

## 7. Verification plan

| Check | Pass condition |
|---|---|
| Article extraction | 10 diverse URLs (news, blog, docs, JS-heavy) → non-empty Markdown, title and URL correct |
| YouTube | 5 videos with captions → transcript in the spoken language, channel and publish date present |
| IG/TikTok | 3 public posts → Supadata returns text or a clear `transcript-unavailable` error; no fabricated summary |
| Dedupe | Re-run the same 5 URLs → all skipped, no new files |
| Vault contract | New notes pass the existing `AGENTS.md` ingest and produce `wiki/sources/` pages |
| Cost | Firecrawl/Supadata dashboards show ≤ free-tier usage for the test month |

---

## 8. Risks and open questions

- **YouTube access:** `yt-dlp` and Web Clipper both depend on YouTube's internal endpoints. They break periodically. Supadata is the paid insurance; keep it configured even if unused most months.
- **Platform terms:** downloading/transcribing TikTok/Instagram is a gray area. Supadata handles it as a vendor; Lind should keep captures private and personal.
- **Firecrawl pricing drift:** the free tier is 1,000 pages/month as of 2026-09-04. If article volume grows, self-host or move to `trafilatura`.
- **Readwise lock-in:** full-text export is good, but the master copy is in their cloud. That is why it is not the primary recommendation.
- **Which "Obsidian scraper" exactly?** This audit assumes Web Clipper + the agent ingest workflow. If Lind means a separate local script, the comparison still holds; only the baseline row changes.
- **Open question for Lind:** is the pain capture (getting content in) or reading (triaging and learning from it)? If it is reading, Readwise Reader deserves a 30-day trial before building the scripted lane.

---

## Sources

- Obsidian Web Clipper — https://obsidian.md/clipper, docs https://help.obsidian.md/web-clipper
- Defuddle YouTube extractor (transcript + `{{transcript}}` variable) — https://github.com/kepano/defuddle/blob/main/src/extractors/youtube.ts
- Web Clipper issue #954 (template properties), #957/#991 (transcript language) — https://github.com/obsidianmd/obsidian-clipper/issues
- Firecrawl pricing and self-hosting — https://www.firecrawl.dev/pricing, https://docs.firecrawl.dev/contributing/self-host
- Firecrawl `/v2/scrape` — https://docs.firecrawl.dev/features/scrape
- Supadata transcript API and pricing — https://docs.supadata.ai/get-transcript, https://supadata.ai/pricing
- Readwise Reader YouTube + Obsidian export — https://docs.readwise.io/reader/docs/faqs/videos, https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian
- Karakeep features and Obsidian plugin — https://docs.karakeep.app/, https://karakeep.app/apps
- Trafilatura benchmarks and CLI — https://trafilatura.readthedocs.io/en/latest/evaluation.html, https://trafilatura.readthedocs.io/en/latest/usage-cli.html
- Vault conventions — `AGENTS.md`, `000 - Claude Context/Web Clipper Templates.md`
