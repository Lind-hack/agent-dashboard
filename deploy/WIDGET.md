# Scriptable widgets

The backend accepts only `GET /api/widget/image?view=today|goals|focus&size=small|medium|large`
with `Authorization: Bearer <WIDGET_READ_TOKEN>`. Use HTTPS at `https://agents.383ks.com`.
The token grants only widget image access; login cookies and HANDOFF_TOKEN cannot replace it.
The existing password login is unchanged. Missing/invalid server configuration returns 503;
missing/wrong authorization returns 401. Invalid query parameters return 400; other methods 405.
All widget responses (including errors) use `Cache-Control: private, no-store, no-cache, must-revalidate`,
CDN no-store, Pragma/Expires and Vary: Authorization. Do not configure a Cloudflare cache-rule
that overrides origin no-store for `/api/widget/*`. The endpoint sets no cookies and supports no writes.

## Provision the server secret

New installations generate a random 256-bit `WIDGET_READ_TOKEN` in `deploy/setup.sh`.
For an existing installation, run in a root/admin SSH session from the deployed checkout:

```bash
cd /opt/agent-dashboard
sudo python3 deploy/configure-widget-token.py
sudo systemctl restart agent-dashboard-web
```

The script writes only `/etc/agent-dashboard.env`, preserving other settings and ownership, with
mode 600. It never prints the token. It leaves an existing generated token intact; it refuses an
unrecognised nonempty value to avoid unexpectedly invalidating an iPhone. The web service's existing
`EnvironmentFile=/etc/agent-dashboard.env` loads it at startup. No daemon-reload is required for an
environment-file edit. The runner does not need restarting. Never use `NEXT_PUBLIC_`, Next config
`env`, a URL query parameter, git, browser storage, a build artifact or a public asset for this secret.
A configured token must contain at least 32 non-whitespace characters; generated tokens are 64 hex.

For code deployment follow README's `deploy/update-web.sh` workflow to preserve running agent jobs.
Build a clean checkout of the merged main commit, verify it, then as `agent` run:

```bash
bash deploy/update-web.sh /path/to/verified-checkout
```

The code can deploy before provisioning; widget requests remain disabled with 503 until the admin
sets the environment variable and reloads the web service. If provisioning happens first, promotion's
web restart picks up the token. Do not restart the runner while it has active jobs.

## Obtain the token for your iPhone

**The token is the `WIDGET_READ_TOKEN` entry in the server's root-only
`/etc/agent-dashboard.env`.** An administrator can open that file using `sudo nano
/etc/agent-dashboard.env` in a private SSH session, then put just that value in their password
manager and retrieve it on the iPhone. It is intentionally unavailable from the dashboard, API,
repository, deployment output, or this issue. Do not copy the whole environment file.
Avoid screen sharing, terminal session recording and clipboard history while handling the value.

Paste the value into your existing Scriptable script's token setting. Prefer storing it once using
Scriptable's Keychain and loading it for the Authorization header, rather than keeping it in a script
that might be shared or synced. Keep the current request URL and `Bearer ` prefix. Never put the
token in the URL, screenshots, chat, issue comments or diagnostic logs. Delete temporary clipboard
contents. To revoke, replace the value with a fresh `openssl rand -hex 32` value in the private admin
session, restart only `agent-dashboard-web`, and update the iPhone. Old values stop working at restart.

## Data and appearance

Every request reads the authoritative local plan (`plans/<local-day>.json`), tasks (`todos.json`),
goals (`goals.md`, with the existing vault fallback), and habits (`habits/`). Focus uses the same Coach
calculation as `/focus`: finished non-break sessions and actual elapsed minutes, never inferred task
completion. Goal progress uses the same weekly goal calculation as the app. Dates use `DASHBOARD_TZ`
(default Europe/Belgrade), including DST. No read triggers planning, task sync, habit logging or edits.

Calendar reads the real primary-calendar snapshot `sources/calendar.json`, maintained hourly by the
existing runner (`SOURCES_ENABLED` must be enabled and Google Calendar connected). It excludes planner
reservation duplicates and shows the snapshot date/time on medium/large widgets; missing snapshots
say “Calendar unavailable”. It can lag the Calendar app by one sync interval (or longer if sync fails).
The layouts now provide a daily command center. Small shows one next action and its actual
session/due time with a segmented completion scale. Medium uses a two-column layout for completion,
completed/remaining task counts, completed focus time, estimated free time, current session and next
event. Large adds a NOW timeline, upcoming block, top three priorities, two weekly goal meters,
three habits with streaks and actionable pace/overload warnings. Goals and Focus views retain their
URLs and select the appropriate next action; Goals medium prioritises a weekly goal meter.
Empty days show no completion percentage or zero-denominator counts. Titles use conservative
font-advance truncation with visible ellipses. No hidden-item count substitutes for useful content.

Daily completion and pace reuse `dayProgress()` with a read-only calendar snapshot; the optional
snapshot parameter leaves existing Coach callers unchanged. Free time is the Coach's estimate of
workday minutes remaining minus timed calendar events (it is not a claim of an empty planner).
Calendar can be stale or unavailable, so this estimate is explicitly labelled. Current focus uses
the actual block state; only a running session with a recorded start shows elapsed minutes.
Priority states use signal colors, while actual runner jobs use their own agent marks and colors.
No job record means no agent status. The generation time is shown as “Updated”; the separate calendar
sync date/time describes source freshness, not generation freshness. PNGs stay still between refreshes.

See [the native ActivityKit feasibility plan](ACTIVITYKIT.md) for a future ticking focus timer.

PNG dimensions at 2x: small 340×340, medium 728×340, large 728×764. Scriptable can scale these for the
specific iPhone's widget family. Palette and panel radius are read directly from `app/globals.css`.
The layout follows DESIGN.md: 16pt gutters, 56pt rows, Geist headings/body, Geist Mono HUD labels,
18px glass panels, hairline dividers, tight tabular numerals and HUD cyan. The static panel gradient
flattens the glass effect into the PNG. Bundled upstream Geist fonts use the included SIL OFL license.
Geist's Latin text includes Albanian; unsupported scripts/emoji become `?` locally so Next's automatic
missing-glyph service cannot transmit personal text. Titles/details truncate to fit widget space.

## Verification

```bash
node --import tsx --test deploy/widget.test.ts
python3 -m unittest discover -s deploy -p 'widget_token_test.py'
npm run typecheck
npm run build
```

No lint command is configured by this repository. Tests exercise the proxy and route, cookie/handoff
isolation, missing config, all nine PNGs, reviewed visual-baseline hashes, exact palette pixels and dimensions, real-source fixtures,
timezone boundaries, read-only behavior, no network during rendering, and generic/log-free errors.
Reviewed synthetic previews are in `deploy/widget-previews/`.
Set `WIDGET_PREVIEW_DIR=/tmp/widget-preview` when running tests to save synthetic fixture PNGs for
visual review. Never export real-data previews into `public/` or commit them.

After deployment, request without a token (expect private 401, or 503 if not provisioned), then use
the private admin environment to test all nine combinations with the bearer header (expect private
200 image/png). Keep tokens out of command arguments/process listings: read the env file in a private
script and pass the header through an HTTP client in memory. Do not enable HTTP header debugging.
The iPhone remains the final check for Scriptable scaling and refresh scheduling.
