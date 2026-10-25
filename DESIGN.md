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
  panel: "22px"
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
---

# Design System: Agentic OS

## Overview

**Creative North Star: "The Night Console"**

A control room you hold in one hand at 1 a.m. The canvas is near-black under a faint coral-and-blue nebula wash. Everything sits on soft glass panels lit from a hairline above. The only spectacle is the live nebula orb. It is the logo, the Talk button and a status light, and it glows more while agents work. Everything else is quiet, so the two agent colours read instantly: coral means Claude, blue means Codex.

Density stays phone-first. Rows are at least 56px tall, one column on the phone and two on desktop, and nothing is smaller than a thumb. Numbers are the heroes: plan usage is set as large tabular numerals next to a textured meter, the way the reference Lind pinned does it. The look is pinned to his "Agentic OS" screenshots, and dark is the only theme.

**Key Characteristics:**
- Near-black canvas, glass panels, hairline borders.
- Agent identity carried by colour (coral Claude, blue Codex, violet Hermes / Codex cloud, mint OpenCode).
- One live signature, the canvas nebula orb. Everything else is still.
- Big tabular numerals for usage, Geist everywhere, mono only for data.

## Colors

A restrained neutral system: most of the screen is canvas and ink, and the colour belongs to the agents.

### Primary
- **Claude Coral** (claude-coral): Claude's dots, meter, tile, running state, text selection and caret. Its deep shade only appears inside the meter gradient.

### Secondary
- **Codex Blue** (codex-blue): Codex's dots, meter and tile. Also links inside agent answers, and the focus ring.

### Tertiary
- **Hermes Violet** (hermes-violet): Codex cloud and Hermes, plus the inbox badge.
- **OpenCode Mint** (opencode-mint): reserved for the OpenCode agent.

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

On the phone there's a sticky top bar (breadcrumb + Voice), a single column with a 16px gutter, and a fixed 5-slot tab bar with the orb raised in the centre. On desktop (≥1024px) a fixed 248px glass sidebar replaces the tab bar. Content is capped at 1120px. The dashboard body splits 1.3 : 1, with every grid track `minmax(0, …)` so long strings truncate instead of widening the page. Chat views cap at 768px, with the composer pinned above the tab bar on the phone and to the bottom on desktop. Sections are 32px apart and rows are at least 56px.

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
- **Sidebar:** grouped links. The active link gets a white/7% fill and an inner top light, and the inbox badge is violet. The orb card sits between the groups.
- **Tab bar:** Home, Inbox, the orb (Talk), Chats, More. Active icons get a heavier stroke and ink colour.

### Usage Meter (signature)
An icon tile, then a recessed pill track, then a fill made of the agent gradient with two drifting dot-grain layers and a soft glow, then the big tabular numeral. Unknown usage shows an empty track and an honest "shows after the next run".

### Nebula Orb (signature)
A canvas nebula of seven drifting colour clouds plus twinkling stars, with a lit sphere in the middle. It runs at about 30fps, pauses offscreen and in background tabs, and shows a still frame under reduced motion.

## Do's and Don'ts

### Do:
- **Do** colour anything agent-related with that agent's own colour (claude-coral, codex-blue, hermes-violet).
- **Do** keep rows at least 56px tall and every action within thumb reach on a 390px screen.
- **Do** show an honest empty state when data is missing. Never a demo number.
- **Do** use real icons (lucide, 1.75 stroke) for every arrow and affordance.

### Don't:
- **Don't** add business or finance demo cards. Lind ruled them out.
- **Don't** nest panels or use coloured side-stripes on rows.
- **Don't** use text glyphs (→, ↗) as icons.
- **Don't** add a light theme.
