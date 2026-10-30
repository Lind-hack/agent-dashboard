# Plan: Agentic OS v3 — living Memory, sorted Inbox, the Orb, motion everywhere
_Locked via claudex-loop — by Claude + Lind (2026-10-30). Lind invoked the escape hatch ("accept all recommendations, just build it"): every open decision below is locked at Claude's recommendation._

## Goal
Make the dashboard the one place Lind throws everything at and gets it back organised. Memory takes any input — typed text, voice, images, video, files, or an image pasted straight from the clipboard — and an automation transcribes/describes it, files it into a section (creating new sections itself when nothing fits), and makes it searchable in a knowledge-graph view next to everything the agents already know. The Inbox adds Gmail, sorted into piles by AI in one tap, next to the PRs/agents/system items it already has. The voice assistant becomes an animated orb in a nebula card, and the whole dashboard gets purposeful motion. Today gets a live Now card and a clearer day.

## Approach
1. **Library store** (`lib/library.ts`): one JSON per item in `DATA_DIR/library/items/<id>.json`, media in `DATA_DIR/library/media/<id>.<ext>`, sections in `DATA_DIR/library/sections.json`. Item = kind (text|voice|image|video|audio|file|link), status (queued|processing|ready|failed), title, summary, text (transcript/description), tags, section, media, createdAt.
2. **Capture API**: `POST /api/memory/items` (text/link JSON), `POST /api/memory/upload` (chunked raw body, 8 MB chunks — the proxy buffers ~10 MB; 200 MB cap), `GET /api/memory/items`, `PATCH/DELETE /api/memory/items/[id]`, `GET /api/memory/media/[id]` (Range support so video seeks), `POST /api/memory/sections`.
3. **Processing in the runner** (`runner/library.ts`, called every tick, one item at a time): voice/audio → ffmpeg → Groq Whisper; video → ffmpeg poster + 3 keyframes + audio track → Whisper + Gemini; image → Gemini (description + OCR); link → page title/description. Then the **organiser** (Groq JSON) picks an existing section or creates one (cap 24 sections, new only when nothing fits), writes title/summary/tags. Mirror note to the vault `100 - Me/memory/<Section>/…md` so Obsidian/Hermes see it too (best effort). Failed items keep their error and a Retry button.
4. **Search**: library items become memory source `capture`; Gmail messages become source `mail`. Per-source on/off toggles in `DATA_DIR/library/sources.json` filter `askMemory`. Voice already calls `askMemory`, so voice answers from captures and mail automatically; the voice brain also gets a `remember` action ("remember that …") that files a text item.
5. **Memory page v3**: capture dock (text, record voice, attach/drop files, paste images anywhere on the page), "Visual cortex" graph (canvas rings: one wedge per source and per section, each record a dot by recency, live search highlight, hover title, click opens), Rings/Timeline tabs, sources panel with toggles + Refresh all, Library grid by section (thumbnails, video posters, voice players, processing shimmer, move/rename/delete).
6. **Inbox v3**: Gmail (read-only, `gmail.readonly` added to `handoff/google-auth.mjs`; Lind re-runs it once). Piles: Reply today, Leads, Sponsors, Billing, Community, Newsletters, FYI, Spam. "Sort all with Core" (Groq, batch) + runner auto-sorts new mail every 10 min. Hero card "N new since this morning" with sorted/time/cost readout. Left rail: Workspace (All, PRs, Agents, System) + Mail piles. Mail opens in Gmail; Done hides locally.
7. **The Orb** (`components/orb.tsx`): WebGL fragment-shader sphere (swirling violet interior, fresnel rim, specular), driven by voice phase + live audio level, falling back to the Core canvas without WebGL / with reduced motion. Nebula card = Magnific nebula video loop + orb + comet streak; replaces the sidebar Core card and the Talk sheet visual.
8. **Motion system**: staggered page entrances, count-up numbers, hover lift on cards, shimmer for processing, section hero loops (Magnific video) on Memory, Inbox and Today, honouring `prefers-reduced-motion` and pausing videos off-screen.
9. **Today**: live Now card (current/next item, countdown, progress ring, day progress) on a dawn loop hero.
10. Typecheck + build, local preview screenshots, Codex post-build inspection, PR. Lind deploys (`update.sh`) and re-runs google-auth for Gmail.

## Key decisions & tradeoffs
- Media lives on the VPS disk, not the Syncthing vault (videos would flood the PC and the phone sync); the vault gets a text mirror only. _(escape hatch)_
- Vision = Gemini 3.5 Flash Lite (free key, verified today); NVIDIA VL models were 410/500/timeout and Groq has no vision model left. Needs `GEMINI_API_KEY` in `/etc/agent-dashboard.env` — Lind adds it; without it images still save, marked "no description yet", and retry when the key appears. _(escape hatch)_
- Processing in the runner, not the web request: survives restarts, one at a time, no request timeouts. _(escape hatch)_
- Gmail is read-only; piles live in the dashboard (`DATA_DIR/mail/piles.json`), Gmail labels are not touched. _(escape hatch)_
- The organiser may create sections; Lind can rename/merge/move. Cap 24 so it can't sprawl. _(escape hatch)_
- DESIGN.md "no decorative blur blobs" is overridden for the Orb/nebula by Lind's explicit request; motion stays purposeful and reduced-motion safe. _(escape hatch)_
- No new animation dependency: CSS + one small WebGL shader, keeping the bundle as is. _(escape hatch)_

## Toolchain
Claude: impeccable / design-taste-frontend / emil-design-eng / improve-animations / find-animation-opportunities / shaders principles for the UI pass; Magnific MCP for images and Kling 2.5 loops (start = end frame); web-design-guidelines for the a11y pass; Codex read-only for the post-build inspection.

## Assumptions
- Live = origin/main 54d1f26, /opt clean (checked over SSH). VPS has ffmpeg + 38 GB free.
- Groq key covers Whisper + JSON; NVIDIA key present; no Gemini key on the VPS yet.
- Google OAuth client is the morning-news desktop client; adding a scope needs one re-consent.

## Risks / open questions
- Google testing-mode refresh tokens expire after 7 days for restricted scopes — if Gmail stops, re-run google-auth.
- Gemini free quota; failures fall back to "saved, no description".

## Out of scope
Sending/archiving mail, Gmail label writes, other inboxes (Slack/WhatsApp), embeddings.
