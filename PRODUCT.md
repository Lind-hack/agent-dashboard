# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: Lind — CS student in Pristina, runs the @building.ai TikTok and several automated projects
(383 news site on Railway, VPS pipelines, trading-brain). He uses this mostly on his phone, away from
his PC, in short bursts between classes and on the move. Technical; prefers to talk (voice) over type.

## Product Purpose

A personal "Agentic OS": the one place to run his projects without the PC. Success = he can go a
full day without his PC: check status, start and steer coding agents, review their PRs, see his
agenda, and ask his memory what was decided.

## Positioning

Not a chat wrapper: it drives the official Claude Code, Codex and OpenCode CLIs on his own VPS
(plus Codex cloud via Linear and his Hermes agent), against his real repos, Linear, systemd timers,
Google Calendar and Obsidian vault.

## Operating Context

- Phone first (installed PWA), desktop second. Dark environments, one hand, voice input.
- Agents: Claude (VPS), Codex (VPS), Codex cloud (Linear), OpenCode with free DeepSeek V4.1 Flash
  (VPS), Hermes (VPS docker agent; its 383 news pipeline stays on ChatGPT auth).
- Data: Linear (Free plan, 250-issue cap), GitHub repos in AGENT_REPOS, systemd timers on the
  Oracle VPS, 383ks.com deployment info, Google Calendar, Obsidian vault (Syncthing on the VPS).

## Capabilities and Constraints

Confirmed sections: Dashboard (Claude/Codex usage left, live agent work, PRs to review, overnight
pipeline health, quick talk), Inbox (things waiting on him: PRs, stuck/asking agents, failed timers,
Codex replies; badge count), Chat (chats with any agent), Calendar (today's agenda from Google
Calendar, add events by voice), Memory (ask with sourced answers across Claude/Codex sessions,
Obsidian, Linear, Claude memory notes; ring/timeline visual to browse), Agents (Claude, Codex,
Codex cloud, OpenCode, Hermes; "Ask all" and "Relay"), Website (383ks.com health: deployed commit,
hourly news published, errors), Settings.

Constraints: free or already-paid providers only; agents only on his VPS via official CLIs; nothing
auto-merges or deploys; Google token is calendar read-only until he re-authorises.

Out of scope: @building.ai image generation, business finance cards, Gmail inbox, Notion/Granola/
email memory sources (later), moving Hermes' live news pipeline off ChatGPT.

## Brand Commitments

Visual reference pinned by Lind: the "Agentic OS" screenshots (near-black canvas, left sidebar with
Workspace/Tools groups, orb/nebula card, large Claude (orange) / Codex (blue) usage meters with big
% numerals, soft glass cards, pill segmented tabs, large sans display headings, ring/timeline memory
visual). Dark theme only.

## Evidence on Hand

All data is real (his jobs, PRs, timers, calendar). Never show fabricated finance or demo numbers;
empty states say what is missing and how to connect it.

## Product Principles

1. Phone-first: every action reachable with a thumb; voice is a first-class input.
2. Show what needs Lind, not everything that exists.
3. Real data or an honest empty state — no demo numbers.
4. The agents do the work; the dashboard never merges, deploys or acts outside the VPS sandbox.
