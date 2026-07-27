# CLAUDE.md

Guidance for Claude Code when working in this repo. Read this fully before making changes.

## What this app is

A **curated YouTube TV guide + remote control** built for one primary user: a senior/parent
watching on an **Apple TV**. The user opens this app on their **iPhone/iPad**, browses recent
uploads and live streams from a handful of favorite channels, and taps a video to **Play Now**
or **Queue Next** on the TV.

The whole point is: **big, obvious, senior-friendly UI** + **one-tap casting to a TV that's
already running the YouTube app.**

## Who it's for (this drives every UI decision)

- One non-technical senior user. Assume large fingers, reading glasses, low patience for clutter.
- **Minimum touch target: 48x48px, prefer 56px+ for primary actions.**
- High-contrast dark mode by default. Large type (base font >= 18px, titles bigger).
- No modals-inside-modals, no tiny secondary controls, no horizontal scrolling.
- Every screen should be usable one-handed on a phone without zooming.

## Tech stack

- **Next.js (App Router) + TypeScript** — do not use the Pages Router.
- **Tailwind CSS** for all styling. No CSS-in-JS libraries.
- **lucide-react** for icons.
- **YouTube Data API v3** for fetching channel uploads and live streams.
- **YouTube Lounge API** (unofficial) for TV playback control.
- Hosted on **Vercel**. Version control with **git**.

## Architecture — READ THIS, IT IS THE MOST IMPORTANT PART

### The browser CANNOT talk to YouTube's APIs directly

Both the YouTube Data API and the Lounge API will **fail from client-side code** — the Data API
key would be exposed, and the Lounge endpoints (`www.youtube.com/api/lounge/...`) do **not** send
CORS headers, so browser fetches to them are blocked.

**Therefore every YouTube call goes through our own server-side Route Handlers** (`app/api/.../route.ts`),
which run on Vercel as serverless functions. The browser talks only to our own `/api/*` routes.

```
[iPhone browser / PWA]
        |  (fetch to our own /api routes only)
        v
[Next.js Route Handlers on Vercel]  <-- API key lives here, in env vars
        |
        +--> YouTube Data API v3   (feeds: uploads + live)
        +--> YouTube Lounge API    (pairing + playback commands)
```

### Lounge Protocol flow (the casting mechanism)

1. TV shows a code under **Settings > Link with TV code** in the YouTube app.
2. Our server calls `GET /api/lounge/pairing/get_screen?pairing_code=<code>` -> returns a **screen_id**.
3. Our server calls `get_lounge_token_batch` with that screen_id -> returns a **lounge_token**.
4. To send a command (play / queue / pause), the server opens a **bind** session and posts the
   command (`setPlaylist`, `play`, `pause`, `next`, `seekTo`, etc).

**Persistence (implemented):** the durable **screen_id** (and the current lounge_token, plus the
active bind-session fields) live in the browser's `localStorage` via `lib/storage.ts`. On load,
`app/page.tsx` restores this immediately — no code re-entry. Command failures recover in tiers
(see the gotcha below); only a dead screen_id falls back to the pairing form.

### Serverless time limits matter

- **Sending commands** (Play Now, Queue, Pause) = short requests. Totally fine on Vercel.
- **Listening for live "now playing" status** uses Lounge's long-polling `bind` channel, which can
  outlive a serverless function's max duration. **Do not** build a persistent listener for the MVP.
  For "now playing" status, do a short-timeout poll (server fetches one event batch, returns fast,
  client re-polls every few seconds), or defer the feature. This is called out again in BUILD_PLAN.md.

## Critical constraints / gotchas

- **The Lounge API is unofficial and undocumented.** It can change or break with no warning. Keep
  all Lounge logic isolated in `lib/lounge/` and `app/api/tv/` so it can be fixed in one place.
  **Do not scatter Lounge calls through UI components.**
- **The bind/BrowserChannel `ofs` param is a running counter, not a constant.** The Lounge `bc/bind`
  endpoint rides Google's BrowserChannel wire protocol. Every POST to it needs `ofs` set to the
  cumulative number of client→server messages already sent on that bind session (SID) — the first
  command after a handshake is `ofs=0`, the next is `ofs=1`, and so on. A wrong/stale `ofs` is **not**
  rejected with an error — the server just silently drops the message as a duplicate (200 OK, no
  effect on the TV), which is a nasty failure mode to debug from the client side. `BindSession` in
  `lib/lounge/client.ts` carries this as `nextOfs` alongside `rid`; if you touch bind-session logic,
  keep both counters flowing through the same request/response round-trip (server ↔ client
  `localStorage`/state, since sessions are reconstructed from what the client sends back each time,
  not held in server memory).
- **Command recovery is three-tiered — know which layer you're touching.** `app/api/tv/command/route.ts`
  no longer just fails when a command errors:
  1. `playVideo()` in `lib/lounge/client.ts` retries once with a fresh bind session on the *same*
     token (handles a stale `sid`/`gsessionid`).
  2. If that still fails, the command route calls `reconnectScreen(screenId)` to re-mint the
     `loungeToken` from the stored `screenId` (no TV code) and retries once more (handles an
     *expired token*). The refreshed token/session go back to the client, which writes through to
     `localStorage` via `lib/storage.ts`.
  3. If reconnecting itself fails, the route returns `{ screenDead: true }` — the only case that
     clears `localStorage` and drops the user back to the pairing-code form.
  If you change bind-session or token logic, preserve this order; collapsing tiers 2/3 back into a
  hard failure reintroduces the "have to re-link every reload" problem this was built to fix.
- **`queueVideo()` (Queue Next) sends `addVideo`, confirmed working on the real TV** (Phase 4).
  Like `playVideo`/`setPlaylist`, it's reconstructed from community reverse-engineering of the
  Lounge protocol, not anything official, so it can still break with no warning if YouTube changes
  the protocol. If Queue Next ever looks like it succeeds but nothing happens on the TV, suspect the
  command name/params first — that's the same "200 OK, silently dropped" failure mode as a stale
  `ofs`, just a different cause. Keep fixes isolated to that one function.
- **Debate Companion (`lib/chapters.ts`, `app/api/chapters/route.ts`, `components/DebateCompanion.tsx`)
  is additive-only.** It reuses the existing `seekTo` Lounge command as-is — `seekTo` already takes
  an absolute time in seconds, so no new Lounge surface was added for it — and fetches
  `videos.list?part=snippet` directly with `YOUTUBE_API_KEY` rather than importing `lib/youtube.ts`,
  so the feed code stays untouched. Do not modify `lib/lounge/`, `app/api/tv/command/route.ts`,
  `lib/youtube.ts`, or `app/api/feed/route.ts` to extend this feature — add to the Debate Companion
  files themselves, or add new files alongside them.
- **YouTube Data API quota = 10,000 units/day (default).** Budget it:
  - Recent uploads: get the channel's **uploads playlist** via `channels.list` (1 unit) then
    `playlistItems.list` (1 unit / 50 items). **Do NOT use `search.list` for uploads** — it costs
    100 units per call and burns quota fast.
  - Live detection: `search.list?eventType=live&type=video&channelId=...` costs 100 units. Use it
    sparingly and **cache** results. Don't refresh live status on every render.
  - Cache/​revalidate feed responses server-side (e.g. revalidate every 5-10 min) so opening the
    app repeatedly doesn't drain quota.
- **Secrets:** the Data API key and any tokens live ONLY in server env vars (`process.env.*`),
  never in client components, never committed. `NEXT_PUBLIC_*` is client-visible — never put the
  API key there.
- **Channel IDs:** resolve channels from their `@handle` at build/fetch time via
  `channels.list?forHandle=@handle` rather than hardcoding raw channel IDs (handles are easier to
  verify and less error-prone). Keep the channel list in one config file (`lib/channels.ts`).

## Project structure (target)

```
app/
  layout.tsx
  page.tsx                 # main feed / tabs
  api/
    feed/route.ts          # GET curated feeds (uploads + live) via Data API
    chapters/route.ts      # GET chapter list for a videoId (Debate Companion)
    tv/
      pair/route.ts        # POST { code } -> { screenId } ; pairs with TV
      command/route.ts     # POST { screenId, token, command, videoId? }
      status/route.ts      # (later) short-poll now-playing
lib/
  channels.ts              # channel config (handles, tab groupings, emoji/labels)
  youtube.ts               # Data API helpers (uploads playlist, live lookup, caching)
  chapters.ts              # pure chapter-timestamp parser for Debate Companion (no network calls)
  lounge/
    client.ts              # Lounge pairing + bind + command encoding (server-only)
  storage.ts               # localStorage helpers for screenId/token (client-only)
components/
  VideoCard.tsx            # thumbnail, title, channel, duration, Play Now / Queue Next
  ChannelTabs.tsx
  RemoteBar.tsx            # floating bottom remote (later phase)
  PairingModal.tsx
  ConnectionStatus.tsx     # green "Connected to Apple TV" indicator
  DebateCompanion.tsx      # chapter list for a selected video; taps seekTo the TV
public/
  manifest.json            # PWA
  icons/                   # PWA icons
```

## Conventions

- **TypeScript strict.** No `any` unless truly unavoidable, and comment why.
- Server-only code (API keys, Lounge, Data API) must never be imported into client components.
  Mark client components with `"use client"` only when they need interactivity.
- Tailwind utility classes in JSX; no separate `.css` files beyond `globals.css`.
- Keep components small and single-purpose. Feed logic lives in `lib/`, not in components.
- Handle loading and error states explicitly for every network call — this app is used by someone
  who won't debug a blank screen. Show a friendly retry.

## Commands

```bash
npm run dev        # local dev at http://localhost:3000
npm run build      # production build (run before assuming a deploy will succeed)
npm run lint       # eslint
```

## Environment variables

Set these in `.env.local` (local) and in the Vercel dashboard (production). Never commit `.env.local`.

```
YOUTUBE_API_KEY=        # YouTube Data API v3 key (server-only, NOT prefixed NEXT_PUBLIC)
ANTHROPIC_API_KEY=      # OPTIONAL, NOT YET USED. Reserved for a future Debate Companion Tier 2
                         # (AI topic grouping + transcript summaries, needing an unofficial
                         # transcript-fetching library). Do not wire this up until that phase is
                         # explicitly started.
```

(The Lounge token is obtained at runtime from the user's TV pairing; it is not an env var.)

## Working agreements for Claude Code

- **Work one phase / one feature at a time.** Follow BUILD_PLAN.md. Do not jump ahead to future
  phases or add features that aren't in the current phase.
- **Make small, reviewable changes.** After each meaningful step, stop and summarize what changed
  so the human can test and commit before moving on.
- **Do not refactor working code unprompted** — especially `lib/lounge/` and `app/api/tv/`. If the
  casting works, do not "improve" it without being asked.
- **Ask before adding a new dependency.** Prefer the standard library / built-in fetch.
- **Never hardcode or log secrets.** Never put the API key in a client component or `NEXT_PUBLIC_*`.
- **When something touches the Lounge API, say so explicitly** and note that it's the fragile,
  unofficial part, so the human tests it on the real TV before we build on top of it.
- If a change spans many files or feels like a big rewrite, **stop and propose the plan first.**
