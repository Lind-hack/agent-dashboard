# Accounts (v7)

Other people can have their own dashboard on this server. Sign-up is invite-only.

## Inviting someone

Settings → **People** → New invite → Copy. Send them the text: it has the sign-up link and the code.
Each code works once. From the same list you can pause an account (signs them out, stops their
background jobs) and resume it.

## What they get

Today, Goals, Buddy, Mirror, Memory, Learning and the Roast room, with their own data, under
`$DATA_DIR/tenants/<id>/`. Your data stays where it always was.

In their Roast room the debaters are the AI keys they added (one per provider) plus any council seats,
and the judge is their first AI. Instead of a repo, they can paste notes for the debaters to argue from.
A verdict can go onto their day plan but never to a coding agent. Each account gets 5 rooms a day.

They don't get the coding agents, Linear, GitHub, mail, TickTick or the website monitor. Those use your
accounts.

A setup guide walks them through:

1. **AI.** Their own free Gemini key (required). Groq, Claude (Anthropic API), OpenAI and OpenRouter
   keys are optional. Keys are checked with the provider and stored encrypted with `KEYS_SECRET`
   (falls back to `SESSION_SECRET`). They never use your keys; with no key, nothing runs.
2. **Time zone.**
3. **Calendar.** Either:
   - **A private calendar link** (iCal/.ics), which works with Google, Apple and Outlook. It's
     read-only, refreshed every 15 minutes, and only fetched from public servers.
   - **Connect Google Calendar**, which needs the client below.
4. **Obsidian.** They download our plugin, already set up for their account, unzip it into
   `<vault>/.obsidian/plugins/` and turn it on. It syncs `.md` and `.canvas` files both ways. When both
   sides changed the same note, it keeps both copies. Limits are 2 MB per note and 200 MB per vault.
   Each device gets its own sync code (up to 5).
5. **Phone notifications.**

## Optional: "Connect Google Calendar" for other accounts

1. In Google Cloud console (the same project as your Calendar sign-in is fine), go to
   APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
2. Under "Authorised redirect URIs", add `https://agents.383ks.com/api/calendar/google/callback`.
3. Put the client ID and secret in `/etc/agent-dashboard.env` as `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET`, then restart the web service.
4. While the app is in "Testing", add each person's Gmail under OAuth consent screen → Test users
   (up to 100). In Testing, Google also expires their sign-in after 7 days, so they have to reconnect.
   Publishing the app removes both limits, but it needs Google's verification for the calendar scope.

Your own Google sign-in still comes from `handoff/google-auth.mjs` on the PC. This doesn't touch it.

## Your login

Unchanged: the password alone. Optionally set `OWNER_EMAIL` to sign in with an email too.
