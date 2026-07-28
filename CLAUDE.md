# CLAUDE.md

Guidance for Claude Code when working in this repo. Read this fully before making changes.

## What this app is

A **curated YouTube TV guide + remote control** built for one primary user: a senior/parent
watching on an **Apple TV**. The user opens this app on their **iPhone/iPad**, browses recent
uploads and live streams from a handful of favorite channels, and taps a video to **Play Now**
or **Queue Next** on the TV. Once something is playing, a **Spotify-style now-playing bar**
(`components/NowPlayingBar.tsx`) sits at the bottom: a collapsed mini-bar and a full-screen
expanded view with play/pause, skip ±10s, next, a **drag-to-seek scrubber**, and a **chapter list**
(jump to timestamps parsed from the video description).

**App shell is Spotify-style, three pages behind a bottom tab bar** (`components/BottomNav.tsx`),
which sits *below* the now-playing mini-bar. **The app is subscription-driven** — there is no manual
channel config; Home and Your Channels both come from the signed-in user's real YouTube subscriptions
via OAuth, so both show a **Connect YouTube** screen (`components/ConnectYouTube.tsx`) until signed in:
- **Home** — recent uploads merged across **all** of his YouTube subscriptions, newest-first
  (`/api/subscriptions/feed`). This is what used to be the "Explore" page.
- **Your Channels** — a big dropdown (`components/ChannelPicker.tsx`) of his subscribed channels (in
  YouTube's own order); picking one shows just that channel's uploads + live (`/api/feed?channelId=`).
- **Queued** — an **in-memory, session-only** mirror of what the user tapped "Queue Next" on. It is
  **not** a live readout of the TV's real queue (the Lounge protocol can't be read back reliably —
  see the Now-playing status section). It auto-prunes a video when that video starts playing, and
  clears on reload so a stale list can't linger. See the "Navigation & pages" gotcha below.

The whole point is: **sleek, modern, obvious UI** + **one-tap casting to a TV that's
already running the YouTube app.** The primary user is a senior, but the design brief evolved to a
**clean Spotify-style look** — large targets and high contrast remain non-negotiable (below), just
dressed in a modern shell rather than a utilitarian one.

## Who it's for (this drives every UI decision)

- One non-technical senior user. Assume large fingers, reading glasses, low patience for clutter.
- **Minimum touch target: 48x48px, prefer 56px+ for primary actions.**
- High-contrast dark mode by default. Large type (base font >= 18px, titles bigger).
- No modals-inside-modals, no tiny secondary controls, no horizontal scrolling.
- Every screen should be usable one-handed on a phone without zooming.
- **Accent color is the app logo's red, `#EF4444` (Tailwind `red-500`)** — sampled from the play
  triangle in `public/icons/icon-512.png`. Use it for primary/active affordances: the active
  bottom-nav tab, the Queued count badge, the card Play button, and the channel dropdown's focus
  border + chevron. (The now-playing bar deliberately stays white — the user likes it as-is; don't
  repaint it.) The **LIVE** badge is `red-600`, a hair deeper, to stay distinct from the accent.

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

- **Sending commands** (Play Now, Queue, Pause, Resume, Seek, Next) = short requests. Fine on Vercel.
- **Listening for live "now playing" status** uses Lounge's `bind` back channel, which would outlive
  a serverless function's max duration if held open. **Do not** build a persistent listener. The
  implemented reader (`lib/lounge/status.ts`) instead makes a *bounded* series of quick
  reconnect-and-read hops within an ~8s budget and returns fast — see the next subsection.

### Now-playing status — implemented, read-only (`lib/lounge/status.ts` + `app/api/tv/nowplaying`)

This is the hardest-won knowledge in the app, reverse-engineered against a real Apple TV. The Lounge
back channel behaves nothing like a normal long-poll, and getting it wrong produces subtle "flicker"
and false "nothing playing" bugs. **Read this before touching status.**

**What the back channel actually does (measured, not assumed):**
- You read events via a **GET** on `/api/lounge/bc/bind` (`RID=rpc`, `TYPE=xmlhttp`). It is **NOT** a
  held-open stream: the server sends **one short batch and closes the connection in ~0.5s**
  (`endedBy: server_close`), even mid-playback. To keep catching events you must **reconnect
  repeatedly** — `fetchNowPlayingBatch` loops quick reconnects within `TOTAL_BUDGET_MS` (~8s).
- Between/without events the server sends **`noop` heartbeats** and nothing else.
- **Steady-state playback emits NO events at all.** A 20s continuous-reconnect trace during untouched
  playback saw 15 reconnects, all `noop`, zero real events. The TV emits playback events **only on
  transitions**: play, pause, seek, video load, stop.
- Playback events are **`onStateChange`** (carries `currentTime`, `duration`, `state`) and, once at
  load, **`nowPlaying`** (carries `videoId`; the real TV did **not** send a title). `onStateChange`
  does **NOT** carry `videoId`/title — so even right after a pause/resume you get position+state but
  no videoId, and during steady playback you usually get nothing.
- Lounge `state` codes: `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, `5` cued.
- Batches also carry unrelated events (`onHasPreviousNextChanged`, `onAudioTrackListChanged`, …) with
  no playback info — don't treat "got some event" as "got a status".

**The reader's contract — a THREE-way result (`parseNowPlayingStatus`):**
- `now_playing` — a play/pause/buffer/cue state, with `positionSeconds` + `durationSeconds`, plus
  `videoId`/`title` carried from a `nowPlaying` event in the same batch if one is present.
- `stopped` — an explicit ended/unstarted state (`0`/`-1`). Playback really stopped.
- `no_update` — **no playback event caught this probe.** This is the normal steady-playback result,
  and also what any connection failure/timeout maps to. **The caller MUST retain its last known state
  on `no_update`.** Conflating `no_update` with "nothing playing" is THE flicker bug — don't.

**Consequences the UI must honor (see `components/NowPlayingBar.tsx`):**
- **Position is extrapolated locally.** The TV gives a position *anchor* only at transitions; between
  them the client advances a local timer (`timeEstimateRef`, ticked ~500ms) and re-anchors from
  `positionSeconds` whenever a `now_playing` arrives or the user issues a command. It can drift on
  un-signaled stalls/ads; it self-corrects at the next transition or user seek. This is also how the
  scrubber and Skip ±10s compute an absolute target.
- **Title/thumbnail come from the app's own feed**, keyed by the `videoId` the app told the TV to
  play (`currentVideoId` → `videosById` in `app/page.tsx`) — NOT from status (status `videoId` is
  usually null). Thumbnail falls back to `i.ytimg.com/vi/<id>/mqdefault.jpg` for a video not in feed.
- **Visibility:** show the bar on `now_playing`, retain on `no_update`, hide on `stopped`.

**Isolation guarantee — why this can't break casting:** the status reader is a **pure GET reader**.
It never POSTs to the bind forward channel, so it **never touches the `ofs` counter** the commands
depend on. That is deliberate. If you ever want the true current state on demand (e.g. the videoId of
a video started on the TV itself, or a cold-start snapshot), the safe way is a single `getNowPlaying`
request **threaded through the same client-held `ofs`/`rid` counter the commands use** — never a
background poller that writes `ofs` independently, which would reintroduce the "stale ofs → silently
dropped" failure and break Play/Pause/Seek. Option 1 (transition-driven + local extrapolation) was
chosen over a continuous `getNowPlaying` poll for exactly this reason; the door to an on-demand
refresh is intentionally left open in `status.ts`'s comments.

**Two status routes exist — don't confuse them:**
- `app/api/tv/nowplaying/route.ts` → `lib/lounge/status.ts` — **the current source of truth. Use this.**
- `app/api/tv/status/route.ts` → `getNowPlayingStatus()` in `lib/lounge/client.ts` — the **legacy**
  Phase-5 probe the old RemoteBar used. **Unused** since RemoteBar was removed; left in place rather
  than deleting fragile Lounge code unprompted. Treat as dead; prefer `/nowplaying`.

A temporary debug page at `app/debug/now-playing/page.tsx` (not linked from the app) polls
`/api/tv/nowplaying` and dumps the parsed + raw values — keep it for re-diagnosing the protocol if
YouTube changes it.

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
- **Now-playing status: `no_update` means "retain", not "nothing playing"; the reader is GET-only.**
  Full protocol findings are in the "Now-playing status" architecture subsection above. The two
  load-bearing rules: (1) a probe that catches no event returns `no_update` and the UI must keep its
  last known state — treating it as "stopped" is the flicker bug we fought hard; (2) `lib/lounge/status.ts`
  is a pure GET reader that never touches the `ofs` counter, so it cannot break casting — keep it that
  way (no `getNowPlaying` background poller). If status "works but is wrong," suspect these two first.
- **The now-playing bar (`components/NowPlayingBar.tsx`) reuses commands and status; it adds no
  Lounge logic.** Every button (play/pause/resume, skip ±10s and the scrubber via `seek`, next) calls
  the page's `sendTvCommand` → `/api/tv/command`; it polls `/api/tv/nowplaying`. It replaced the old
  `RemoteBar.tsx` (deleted) so there is exactly ONE *now-playing* bar. Keep new playback UI here
  rather than scattering command/status calls elsewhere. **Bottom stacking:** `BottomNav` is fixed at
  the very bottom (z-30); the collapsed mini-bar floats directly above it via the `navHeightRem` prop
  (pass `NAV_HEIGHT_REM`); the expanded full-screen view (z-40) still covers everything, nav included
  — Spotify-style. `page.tsx` reserves bottom padding on `<main>` to clear both.
- **Navigation & pages (`page.tsx` + `components/BottomNav.tsx`) — three pages; the app is
  subscription-driven (no manual channel config).** Home = unified feed across ALL subscriptions
  (`/api/subscriptions/feed`); Your Channels = a picker over his subscribed channels
  (`/api/subscriptions`) → one channel's feed (`/api/feed?channelId=`); Queued = the **in-memory
  `queued` list**. Home and Your Channels both need OAuth, so both render `ConnectYouTube` until
  signed in (connection state = `subsState`, established by the `/api/subscriptions` fetch). The queue
  is a deliberate *client-side mirror*, NOT the TV's real queue — the Lounge protocol can't be read
  back reliably (same reason the status reader is transition-only). Rules that keep it honest: (1)
  "Queue Next" appends to `queued`; (2) Play Now (or any local play) **auto-prunes** that video from
  `queued`; (3) it's never persisted, so it resets on reload instead of showing a stale list. It won't
  catch videos queued from the TV's own remote — the empty state says so. If asked to make Queued
  authoritative, that means an on-demand playlist *read* (the documented, unbuilt `getNowPlaying`-style
  option) — fragile, test on the real TV; don't fake it with persistence.
- **The whole feed is his real subscriptions via Google OAuth (`lib/googleAuth.ts` +
  `app/api/auth/youtube/*` + `app/api/subscriptions[/feed]`). This is NOT "recommendations."** YouTube
  exposes no personalized-recommendations API (the old home feed, related-videos, and watch-history API
  access were all removed); the only way to get his true algorithmic recs is scraping the internal
  InnerTube API with his logged-in cookies — ToS-violating, account-risky, and unstable, so it's
  deliberately NOT done. We show recent uploads from the channels he actually subscribes to
  (`youtube.readonly`). Load-bearing rules: (1) **Secrets stay server-side** — the OAuth client secret +
  `OAUTH_TOKEN_SECRET` are env-only; the refresh token lives ONLY in an **encrypted httpOnly cookie**
  (`yt_oauth`), never localStorage / never `NEXT_PUBLIC`. (Contrast the Lounge session in
  `lib/storage.ts`, which is client-side localStorage because it's not a Google-account secret.) (2)
  **OAuth'd Data API calls MUST be `cache: "no-store"`** — user-private data must never enter Next's
  shared `revalidate` cache (it would leak/stale across users); the by-channelId feed uses the API key
  and keeps its cache. `youtubeGet`'s token arg enforces this split. (3) **Quota:** Home fans out one
  `playlistItems.list` per subscription (per the owner's "all subscriptions" choice — no channel cap;
  `SUBS_MAX_PAGES` bounds pagination). The client caches Home in state (fetched once per connect, not
  per tab switch) to keep this affordable — don't move Home fetching to a per-render/per-tab trigger.
  (4) **Consent screen must stay published to Production** (unverified is fine — one-time warning) so the
  refresh token doesn't expire every 7 days (the "Testing"-mode trap). One subscribed channel that 404s
  (empty/hidden/"Topic" uploads) must not sink Home — `getSubscriptionsFeed` uses `Promise.allSettled`.
  No new npm deps — OAuth is plain `fetch` + `node:crypto`. Keep OAuth logic in these files; don't
  scatter it into UI.
- **Debate Companion (`lib/chapters.ts`, `app/api/chapters/route.ts`, `components/DebateCompanion.tsx`)
  is additive-only, and now lives inside the now-playing view.** It reuses the existing `seekTo`
  Lounge command as-is (absolute seconds, so no new Lounge surface) and fetches
  `videos.list?part=snippet` directly with `YOUTUBE_API_KEY` rather than importing `lib/youtube.ts`,
  so the feed code stays untouched. As of the now-playing phase it is rendered by
  `NowPlayingBar`'s expanded view, keyed to the currently-playing video — NOT by the feed cards
  (`VideoCard` is a plain card again). Do not modify `lib/lounge/`, `app/api/tv/command/route.ts`,
  `lib/youtube.ts`, or `app/api/feed/route.ts` to extend this feature — add to the Debate Companion
  files themselves, or new files alongside them.
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
- **Channels come from his OAuth subscriptions, not config.** There is no manual channel list — the
  app resolves channels from the signed-in user's `subscriptions.list` (channelIds), then their uploads
  playlists via `channels.list?id=` (batched). Don't reintroduce a hardcoded `lib/channels.ts` or
  `@handle` resolution; if you need a channel's feed, use `getChannelFeedById(channelId)`.

## Project structure (target)

```
app/
  layout.tsx               # PWA meta + viewport-fit=cover (iOS safe-area insets for the bar)
  globals.css              # Tailwind + base; also the now-playing scrubber's range-input CSS
  page.tsx                 # app shell: pairing screen, or the 3 pages (Home/Your Channels/Queued) +
                           #   BottomNav + NowPlayingBar. Owns activePage, subsState (OAuth connection +
                           #   subscribed-channel list), homeFeed, selectedChannelId + channelFeed, the
                           #   in-memory `queued` list, currentVideoId, and an accumulating metaMap (so
                           #   the bar survives page switches). Handles the ?connected=1 OAuth return.
  debug/
    now-playing/page.tsx   # TEMP debug page (not linked in app): dumps /api/tv/nowplaying parsed+raw
  api/
    feed/route.ts          # GET one channel's uploads + live by `?channelId=` (public, API key)
    chapters/route.ts      # GET chapter list for a videoId (Debate Companion)
    subscriptions/route.ts # GET his subscribed channels (OAuth) — Your Channels picker + connection check
    subscriptions/feed/route.ts # GET Home feed: recent uploads across ALL subscriptions (OAuth)
    auth/
      youtube/
        login/route.ts     # GET: set CSRF state cookie, 302 to Google consent
        callback/route.ts  # GET: verify state, exchange code, store ENCRYPTED refresh token cookie
        logout/route.ts    # POST: clear the refresh-token cookie (disconnect)
    tv/
      pair/route.ts        # POST { code } -> { screenId } ; pairs with TV
      command/route.ts     # POST { ...session, command, videoId?/seekSeconds? } (play/queue/pause/resume/next/seek)
      nowplaying/route.ts  # GET now-playing status (Tier 1 reader) — SOURCE OF TRUTH
      status/route.ts      # LEGACY Phase-5 now-playing probe; UNUSED since RemoteBar removed
lib/
  googleAuth.ts            # server-only Google OAuth: auth-URL/token exchange/refresh via plain fetch,
                           #   AES-256-GCM encrypt of the refresh-token cookie (node:crypto),
                           #   getAccessToken(request). No new npm deps.
  youtube.ts               # Data API helpers. youtubeGet takes an optional OAuth token (Bearer +
                           #   no-store) for private data. getSubscribedChannels() (Your Channels list),
                           #   getSubscriptionsFeed() (Home, all subs, allSettled), getChannelFeedById()
  chapters.ts              # pure chapter-timestamp parser for Debate Companion (no network calls)
  lounge/
    client.ts              # Lounge pairing + bind + command encoding (server-only)
    status.ts              # read-only now-playing bind-channel reader (server-only); GET-only, no ofs
  storage.ts               # localStorage helpers for screenId/token (client-only)
components/
  BottomNav.tsx            # Spotify-style bottom tab bar (Home/Your Channels/Queued — 3 tabs); red
                           #   active tab + Queued count badge. Exports NAV_HEIGHT_REM so the mini-bar
                           #   sits above it.
  ChannelPicker.tsx        # native <select> dropdown for Your Channels (generic {id,label} options)
  ConnectYouTube.tsx       # "Connect YouTube" screen — shown on Home/Your Channels when not signed in
  VideoCard.tsx            # sleek card: 16:9 thumbnail, duration pill, pulsing-dot LIVE badge, an
                           #   icon-only red Play button + Queue Next; optional Remove (Queued page)
  NowPlayingBar.tsx        # Spotify-style bottom bar: mini + full-screen; play/pause, skip ±10s, next,
                           #   drag-to-seek scrubber, and the DebateCompanion chapters. Replaced RemoteBar.
                           #   `navHeightRem` prop lifts the collapsed mini-bar to sit above BottomNav.
  PairingModal.tsx
  ConnectionStatus.tsx     # "Connected to Apple TV" indicator; `compact` variant = icon-only pill for
                           #   the per-page header (full labelled pill on the pairing screen)
  DebateCompanion.tsx      # chapter list; rendered inside NowPlayingBar's expanded view; taps seekTo the TV
public/
  manifest.json            # PWA
  icons/                   # PWA icons
```

## Conventions

- **TypeScript strict.** No `any` unless truly unavoidable, and comment why.
- Server-only code (API keys, Lounge, Data API) must never be imported into client components.
  Mark client components with `"use client"` only when they need interactivity.
- Tailwind utility classes in JSX; no separate `.css` files beyond `globals.css`. (The only
  hand-written CSS is the now-playing scrubber's range-input pseudo-elements in `globals.css` —
  `::-webkit-slider-thumb` etc. can't be expressed as Tailwind utilities.)
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
GOOGLE_OAUTH_CLIENT_ID= # Subscriptions: OAuth "Web application" client (same GCP project as the key)
GOOGLE_OAUTH_CLIENT_SECRET= # server-only OAuth client secret — NEVER NEXT_PUBLIC, never committed
OAUTH_TOKEN_SECRET=     # random 32+ char string; encrypts the refresh-token cookie (AES-256-GCM)
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
