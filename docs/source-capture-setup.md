# Source capture — setup and daily use

The Memory page now has a `/read` command. Paste an article or video link and the dashboard saves
the readable text (or transcript) into `raw/inbox` with provenance, then reindexes Memory so it is
searchable immediately. This is the scripted lane from
[`docs/research/LIN-955-source-capture.md`](research/LIN-955-source-capture.md), wired into the
dashboard instead of a separate script.

## What is already wired

| Piece | Where |
|---|---|
| `/read <url>` in the Memory composer | `components/memory-view.tsx` |
| `POST /api/memory/read` | `app/api/memory/read/route.ts` |
| Article lane: Firecrawl → plain fetch | `lib/source-capture.ts` |
| Video lane: `yt-dlp` captions → Supadata | `lib/source-capture.ts` |
| URL dedupe + Markdown note writer | `lib/source-capture.ts` |
| Write access to the vault inbox | `deploy/vault-access.sh` |

A bare URL in the Memory composer also works. The note is written to
`raw/inbox/YYYY-MM-DD <title-slug>.md` with `title`, `source`, `source_url`, `type`, `capture_tool`,
`captured_at`, optional `youtube_channel`, and `tags: [clipped, inbox]`.

## One-time setup

1. **Add the capture keys** to `/etc/agent-dashboard.env` on the VPS (root-owned, mode 600):

   ```bash
   sudo sh -c 'cat >> /etc/agent-dashboard.env' <<'EOF'
   FIRECRAWL_API_KEY=fc-...
   SUPADATA_API_KEY=...
   EOF
   ```

   Firecrawl handles JS-heavy articles; Supadata is the fallback for video transcripts when
   `yt-dlp` cannot get captions. Without keys the article lane still works with a plain fetch,
   but the video lane has no fallback. Free tiers are enough for normal use.

2. **Install `yt-dlp` on the VPS** (optional, recommended):

   ```bash
   sudo apt-get install -y yt-dlp
   ```

   The dashboard runs as `agent`, so the binary must be on that user's `PATH` (the distro package
   installs to `/usr/bin/yt-dlp`).

3. **Grant the dashboard write access to the two inboxes** (once, as `ubuntu`):

   ```bash
   bash /opt/agent-dashboard/deploy/vault-access.sh
   ```

   This adds ACLs for `raw/inbox` (captured sources) and `100 - Me/memory/inbox` (`/remember`),
   then restarts the web service. It is safe to re-run after a vault move.

4. **Verify**:

   - **Settings** should show Firecrawl and Supadata as connected.
   - Open **Memory**, send `/read https://example.com/some-article`, and check that the reply says
     `Read · raw/inbox/...` and the new note appears in a Memory search.

## Daily workflow

1. **Capture from the phone or desktop.** In Memory, send:

   ```text
   /read https://example.com/article
   /read https://www.youtube.com/watch?v=...
   ```

   or paste the URL by itself. The dashboard writes the note to `raw/inbox` and reindexes Memory.

2. **Keep Web Clipper for reading/highlighting.** Both paths land in `raw/inbox`; the difference is
   that Web Clipper keeps the page's clip template and `/read` keeps a clean Markdown body plus
   capture metadata.

3. **Ingest on your normal cadence.** Ask an agent: “ingest the new source in raw/inbox”. The vault
   protocol in `AGENTS.md` applies: one `wiki/sources/` page, concepts/entities, `index.md`, `log.md`,
   then move the raw file to `raw/processed/`.

4. **For batches**, send one `/read` per link (or use the reference `read-collect.mjs` in the
   research doc from a terminal). The dashboard path is intentionally one link per message so a
   failure is visible.

## Dedupe and the existing duplicates

`/read` checks `raw/inbox`, `raw/processed`, and `raw/sources` for the same `source:` URL before
writing. A duplicate returns `Already in the vault · <path>` and does not create a second note.
It does **not** delete the 18 duplicate re-clips already in the vault — clean those deliberately:

```bash
cd /var/lib/agent-dashboard/vault
grep -rh '^source:' raw | sed 's/^source: *//' | sort | uniq -d   # duplicate source URLs
grep -rl '^source: "https://example.com/the-duplicate"' raw        # files to compare
```

Keep the newest file, move it to `raw/processed/`, and update any `wiki/sources/` page that points
at the removed path.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `The vault's raw/inbox isn't writable…` | Run `deploy/vault-access.sh` on the VPS. |
| `No transcript found…` | Install `yt-dlp` or set `SUPADATA_API_KEY`; check the video has captions. |
| `Couldn't extract readable text…` | Set `FIRECRAWL_API_KEY` (the page is probably JS-rendered or paywalled). |
| `The page returned 403/404` | The site blocks the plain fetch; Firecrawl may still work. |
| Firecrawl quota exhausted | The code falls back to plain fetch automatically; transcripts still use `yt-dlp`/Supadata. |
| Note exists but Memory does not show it | Memory reindexes on write; reload the page. If the vault path is wrong, check `MEMORY_VAULT_DIR`. |
