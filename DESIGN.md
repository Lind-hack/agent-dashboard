---
name: Agentic OS
description: Lind's phone-first control room for his agents, projects and day.
colors:
  canvas: "#08080a"
  canvas-raised: "#0e0e11"
  ink: "#ededf0"
  ink-muted: "#9a9ca6"
  ink-faint: "#85888f"
  hairline: "rgb(255 255 255 / 0.07)"
  hairline-strong: "rgb(255 255 255 / 0.12)"
  claude-coral: "#e2825f"
  claude-coral-deep: "#9c4a31"
  codex-blue: "#7c98ff"
  codex-blue-deep: "#3a4fae"
  hermes-violet: "#b392f0"
  opencode-mint: "#5fd3a6"
  signal-ok: "#5fd39a"
  signal-warn: "#f2c14e"
  signal-bad: "#f06c6c"
  hud: "#a9e4f5"
  hud-dim: "rgb(169 228 245 / 0.14)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 6vw, 3.6rem)"
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.035em"
  numeral:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.4rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.05em"
    fontFeature: "tnum"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.14em"
  data:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  control: "12px"
  composer: "26px"
  panel: "18px"
  agent-tile: "30% of tile size"
  pill: "9999px"
spacing:
  row-min: "56px"
  gutter: "16px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-ghost:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  chip-filter-on:
    backgroundColor: "#ffffff"
    textColor: "{colors.canvas}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  chip-filter-off:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "6px 14px"
  list-row:
    textColor: "{colors.ink}"
    height: "{spacing.row-min}"
    padding: "12px 16px"
  hud-label:
    fontFamily: "Geist Mono"
    fontSize: "10.5px"
    letterSpacing: "0.18em"
    textColor: "{colors.ink-faint}"
  agent-tile:
    rounded: "{rounded.agent-tile}"
    backgroundColor: "#0d0d11"
---

# Design System: Agentic OS

## Overview

**Creative North Star: "The Night Console, v2 — an instrument panel around a living core."**

A control room you hold in one hand at 1 a.m., now read like an instrument panel (Lind's references:
the Agentic OS memory cortex, the Jarvis HUD, the router pick card). The canvas is near-black over a
faint instrument grid that fades out below the top of the page and a cold HUD wash. The one spectacle
is the **Core**: a slowly turning sphere of points with constellation lines, drawn live. It is the
logo, the Talk button and the system's status light; it brightens, speeds up and takes on the colours
of whichever agents are working. Around it, the agents dock as their **real marks** (Claude's
starburst, OpenAI's knot for Codex, OpenCode's frame, Nous Research for Hermes) on dark glass tiles
lit from inside by the agent's colour. Readouts are set as instruments: mono uppercase labels,
segmented scales, big tabular numerals, corner brackets on the live cards.

Density stays phone-first. Rows are at least 56px tall, one column on the phone, three instrument
columns around the core on desktop. Numbers are the heroes; agents are always shown by their marks,
never by a plain coloured circle. Dark is the only theme.

**Key Characteristics:**
- Near-black canvas, fading 48px instrument grid, glass panels, hairline borders, 18px radius.
- Agent identity = real mark + agent colour (coral Claude, blue Codex, mint OpenCode, violet Hermes).
- HUD cyan (#a9e4f5) is the OS's own instrument light: labels, lines, the idle core, the active nav tick.
- One live signature, the Core. Everything else is still except the working-agent sweep.
- Geist for words and numerals, Geist Mono only for labels, ids, times and data.

## Colors

A restrained neutral system: most of the screen is canvas and ink, and the colour belongs to the agents.

### Primary
- **Claude Coral** (claude-coral): Claude's dots, meter, tile, running state, text selection and caret. Its deep shade only appears inside the meter gradient.

### Secondary
- **Codex Blue** (codex-blue): Codex's dots, meter and tile. Also links inside agent answers, and the focus ring.

### Tertiary
- **Hermes Violet** (hermes-violet): Codex cloud and Hermes, plus the inbox badge.
- **OpenCode Mint** (opencode-mint): reserved for the OpenCode agent.

### Command
- **Command Blue** (command, #6cb6ff): skill and command tokens only — "/impeccable" chips, the skill names in the "/" menu, and "/skill" or "$skill" in sent messages. Distinct from Codex Blue on purpose; never decoration.

### HUD
- **HUD Cyan** (hud): the system's voice, not an agent. Mono labels' accents, wires between the core and idle docks, the idle core, the active-nav tick, corner brackets, live "now" times.

### Neutral
- **Canvas** (canvas): the page ground everywhere. **Canvas Raised** (canvas-raised) sits behind sheets and the composer.
- **Ink** (ink): primary text, and the fill of the primary button.
- **Ink Muted** (ink-muted): secondary lines, row details, inactive nav.
- **Ink Faint** (ink-faint): timestamps, hints, group labels. Kept at ≥4.5:1 on the canvas because it carries small text.
- **Hairline / Hairline Strong**: panel borders and row dividers, plus hover/focus borders.
- **Signals** (signal-ok / warn / bad): status dots and error copy only, never decoration.

### Named Rules
**The Agent Owns Its Colour Rule.** Coral and blue mean Claude and Codex, nothing else. A third use of coral for "accent" would make the status dots lie.

**The Signal Is Not Decoration Rule.** Green, amber and red appear only as state: health dots, error panels, a meter at ≥80%.

## Typography

**Display Font:** Geist (with system sans)
**Body Font:** Geist
**Label/Mono Font:** Geist Mono, for commits, unit names, branches and tool steps.

**Character:** One neo-grotesk, tightened hard at display sizes. It reads like an OS, not a brand page.

### Hierarchy
- **Display** (600, 2.4rem → 3.6rem, 1.02): the dashboard greeting only.
- **Headline** (600, 2rem → 2.6rem, 1.05): page titles (Inbox, Chats, 383ks.com).
- **Numeral** (600, 2rem phone / 3.4rem desktop, tabular, -0.05em): usage percentages and website stats.
- **Body** (400, 15px, 1.6): rows, chat messages, agent answers.
- **Label** (500, 11px, 0.14em, uppercase): sidebar group names (Workspace, Tools) only.

### Named Rules
**The Numerals Are Tabular Rule.** Any number that is compared or ticks (usage, ms, counts) uses tabular figures.

## Layout

On the phone there's a sticky top bar (breadcrumb + Voice), a single column with a 16px gutter, and a fixed 5-slot tab bar with the Core squircle raised in the centre. On desktop (≥1024px) a fixed 248px glass sidebar replaces the tab bar. Content is capped at 1180px. The home splits into three instrument columns (0.9 : 1.5 : 0.95, core in the middle) and then 1.25 : 1, with every grid track `minmax(0, …)` so long strings truncate instead of widening the page. Chat views cap at 768px, with the composer pinned above the tab bar on the phone and to the bottom on desktop. Sections are 32px apart and rows are at least 56px.

## Elevation & Depth

Depth comes from glass, not stacked shadows. A panel is a top-lit translucent gradient with a 1px hairline, an inner top highlight, a soft offset drop shadow (`0 18px 40px -24px`) and an 18px backdrop blur over the nebula wash. Sheets add a dimmed, blurred backdrop. Meters are the one recessed element, with an inset shadow under the track.

### Named Rules
**The One Glass Layer Rule.** Panels don't nest. A list inside a panel uses hairline-divided rows, never cards inside a card.

## Shapes

Softly rounded panels (22px), pill controls, 12–14px icon tiles and controls, and a 26px composer capsule. Chat bubbles are 20px, with the corner nearest the speaker pinched to 6px.

## Components

### Buttons
- **Primary:** ink pill with canvas text (send, New chat). It fades to 20% opacity when disabled.
- **Ghost:** muted text, pill, white/5 hover fill (Voice, Chat, Mark all done).
- **Danger ghost:** coral-red outline for Stop and Sign out.

### Chips
- **Filter chips:** white fill with canvas text when on, hairline outline with muted text when off. They scroll sideways on the phone.

### Cards / Containers
- **Panel:** see Elevation. List rows inside are separated by hairlines and lighten to white/2% on hover.

### Inputs / Fields
- **Style:** transparent field inside a hairline container. The border strengthens on focus, and the caret is coral.

### Navigation
- **Sidebar:** Core brand mark, then grouped links under HUD labels. The active link gets a white/6% fill, an inner ring and a glowing HUD tick at the edge; the inbox badge is a violet mono count. The Core card (tap to talk, shows working agents' tiles) sits between the groups.
- **Tab bar:** Home, Inbox, the Core squircle (Talk), Today, More. The active tab gets a heavier stroke, ink colour and a glowing HUD tick above it.

### Agent Tile (signature)
The agent's real mark on a #0d0d11 glass tile (radius 30% of size; xs 20 · sm 28 · md 36 · lg 48 · xl 64px), lit by a radial wash of the agent colour and a 1px agent-tinted inner ring. States: ready (lit), idle (neutral ring), working (a light sweep runs around the edge, 2.4s), off (45% opacity, greyscale). Used everywhere an agent appears: chats, inbox, docks, usage, the agents console.

### Core (signature)
Canvas sphere of ~590 points (Fibonacci, jittered) with lines between near neighbours, slow rotation, depth-faded, twinkling, HUD cyan when idle; working agents' colours mix in and energy raises speed and brightness. ~30fps, paused offscreen and in background tabs, one still frame (redrawn on status change) under reduced motion. Small densities for the brand mark, sidebar card and the phone Talk button (an 18px-radius squircle, never a circle).

### Core Stage (home)
The Core in a bracketed panel with the four agents docked at its corners (mark, name, what it's on), wired to the core by a dashed HUD line (solid in the agent colour while working), and a readout line beneath (runner, brain, vault, 383). On the phone the docks drop into a 2×2 grid under the core.

### Usage Gauge
Agent tile + mono label ("CLAUDE · WEEKLY") + reset line, a big tabular numeral, and a 40-segment scale lit in the agent colour with a soft glow (warn at ≥80%), ticks 0–100 in mono. Unknown usage leaves the scale dark with "Shows after the next run".

### Room (Solo · Team · Roast)
Mode switch is a 3-segment control (ink fill on the active segment). Agents are picked from 2×2 (phone) / 4-up (desktop) cards: an lg Agent Tile, name, the real model in mono, readiness/usage; a picked card gets a 1px ring and glow in the agent colour plus an ink check badge. The picking panel carries corner brackets. Roast shows the judge, the call budget and warnings (shared model, Claude opt-in) under the cards.

### Debate view
A segmented agreement meter (HUD cyan, signal green at ≥80) with the per-round trail in mono. Each round is a row of answer cards (phone: horizontal snap-scroll at 86vw; desktop: one column per agent) — tile, name, model, a big confidence numeral, the one-sentence position, "agrees with" chips (xs tiles), roasts with a flame icon, and a collapsible full answer. The judge's notes sit under each round (blocking disagreements outlined in red). The Verdict card is the router-pick card from Lind's reference: bracketed, outcome chip, one support card per agent with the picked one ringed in its colour, the recommendation, next step, dissent, then "Run it with <agent>" buttons (picked first, ink).

### Command Palette
⌘K / Ctrl+K anywhere, or the Search button (top bar) / tile (More). A bracketed glass panel dropping from the top (opens in 170ms from 0.98 scale, scrim fades in 140ms, no motion under reduced-motion). The search row shows focus as a HUD-cyan underline instead of a ring. Results group under HUD labels — Do (typed text becomes "Roast: …" and "Ask memory: …"), Go to, Chats (agent tiles), Roasts (stacked tiles) — with the active row lit and a return-key glyph. Full combobox semantics, ↑↓/Enter/Esc, IME-safe, focus restored on close.

### Status Pill
A 24px-tall mono uppercase chip with a 1px tinted border: live (HUD cyan, optional pulse) for running/queued/preparing, ok for "your turn"/connected, bad for failed/offline, warn for not set, neutral for done. Used for state everywhere instead of colored text or dots.

### Segmented Filter
Link-based (state lives in the URL), a 12px-radius track with 9px-radius segments; the active one is ink-filled, counts in mono. Chats, Inbox.

### Page Readout
Under every page title and its plain sentence, a HUD-label line of live counts (e.g. "11 OPEN · 1 RUNNING · 10 WAITING ON YOU"). Only real numbers; items with nothing to say are omitted.

### Time Rail (Today)
Schedule as a vertical rail: mono start/end times, a 10px square node per event in its calendar colour (HUD cyan and glowing while it's happening), and a NOW separator — the current time in HUD cyan, a glowing dot on the rail and a fading line.

### Skill Picker ("/" menu)
In any chat box with a known agent, typing "/" (or "$") opens a menu above the box: a HUD-label header with how many skills that agent has on the VPS, then up to 8 matches — the invocation in Command Blue mono, a one-line description, and a source tag (YOURS / ACCOUNT / PLUGIN / CODEX). ↑↓ + Enter/Tab or tap picks; the typed "/word" disappears and a Command Blue chip (8px radius, tinted fill, inner ring, × to remove) appears above the text. At most 4 per message; the menu says so when full. Sent messages show the tokens in Command Blue.

### Agent Chat (signature)
Each chat takes on its agent: `--agent` (the agent colour) is set on the view and carries the text selection, the caret, the composer's focus glow and a hairline under the header — lit while idle, with a light travelling along it while the agent works. The header leads with the agent's identity (md Agent Tile with its working sweep, name, where it runs in mono) and a "Read aloud" switch. Each agent turn opens with an xs tile and the agent's name in its colour; answers sit in a panel with an agent-tinted top edge and a footer of Listen (in that agent's voice, bars move while it plays) · Copy · cost. Tool runs collapse into one chip with per-kind icons and counts (read · edit · run · search · web · tool) and the latest step; it folds open by animating the grid row. While the agent works, its tile sweeps beside "<Agent> is <verb>…" with the current step in mono (Claude thinking, Codex working, OpenCode coding, Hermes running). Messages that arrive while you watch rise 8px out of a 3px blur in 260ms; what was there at load doesn't move. Scrolled up, new messages raise a "New from <Agent>" pill instead of yanking the page.

### Voice (Talk to the Core)
The Talk sheet opens on Talk; New chat is the second tab. The Core is the button: a 30%-radius squircle whose rim glow follows the sound (`--lvl`) — white while it listens, HUD cyan while it speaks — and whose point sphere speeds up while it thinks. One HUD label says the state (Tap to talk · Listening · Thinking · Speaking — tap to cut in), with the last line of the conversation under it and earlier turns in a short list. Listening stops by itself after ~1.2 s of quiet; tapping always works (send, cut in). Real work comes back as an action card (agent tile, what will run, Cancel / Run) announced to screen readers; nothing runs until Lind taps Run or, hands-free, answers the Core's "Shall I go ahead?" with a yes. Hands-free, type-instead and mute live in a quiet row at the bottom. Voices: every agent has its own (lib/voices.ts) — Groq Orpheus when available, Kokoro on the VPS otherwise.

### HUD Label
Geist Mono 10.5px, 0.18em tracking, uppercase, ink-faint. Section and readout labels only (DIRECTIVES, PLAN USAGE, CORE · IDLE), never body copy and never a kicker above a heading.

## Do's and Don'ts

### Do:
- **Do** colour anything agent-related with that agent's own colour (claude-coral, codex-blue, hermes-violet).
- **Do** keep rows at least 56px tall and every action within thumb reach on a 390px screen.
- **Do** show an honest empty state when data is missing. Never a demo number.
- **Do** use real icons (lucide, 1.75 stroke) for every arrow and affordance.
- **Do** show an agent by its mark in an Agent Tile, everywhere.
- **Do** keep HUD cyan for the system itself and agent colours for agents.

### Don't:
- **Don't** add business or finance demo cards. Lind ruled them out.
- **Don't** nest panels or use coloured side-stripes on rows.
- **Don't** use text glyphs (→, ↗) as icons.
- **Don't** add a light theme.
- **Don't** use plain coloured circles or gradient blobs as agent avatars or buttons.
- **Don't** put corner brackets on every card: they mark live instruments (the core, the Talk sheet, the palette, verdicts, the plan).
- **Don't** use decorative blur blobs; glass is for overlays and panels only. (The Orb and its nebula are the one exception — Lind asked for them, 2026-10-30; see "v3".)

## v3 — the Orb, section heroes, motion (2026-10-30)

- **The Orb** (`components/orb.tsx`) is the voice assistant's face: one WebGL fragment shader (swirling violet gas, teal veins, fresnel rim, specular), states idle / listening / thinking / speaking driven by the real audio level. It lives in a **Nebula card** (Magnific nebula loop + comet arc) in the sidebar, the Talk sheet, the phone tab bar and the Inbox sort card. Without WebGL it falls back to a still CSS sphere; with reduced motion it draws one frame per state.
- **Section heroes** (`SectionHero` in `components/motion.tsx`): Memory, Inbox and Today open on a looping Magnific clip (`public/media/*-loop.mp4`, posters `.webp`) under a left-to-right dark scrim; the clip only plays on screen and never with reduced motion.
- **Motion vocabulary** (globals.css "v3 motion system"): `page-in` (opacity only — a transform would capture the fixed bars), `stagger` children, `lift` + `press` for anything tappable, `shimmer` while the automation reads something, `land` when it arrives, `CountUp` numbers, `day-bar`. All of it switches off under `prefers-reduced-motion`.
- **Memory**: Visual cortex rings (canvas) — wedges are Library sections, mail piles and sources; dots by recency; search lights hits and draws them to the core; answers light their sources. Sources panel with switches (search scope) and the pink "Refresh all".
- **Inbox**: pile colours live in `lib/piles.ts`; the pink gradient button is the one "let the Core do it" action per page (Sort all, Refresh all).
