# BUILD_PLAN.md — Curated YouTube TV Guide + Remote

A phased plan designed to **prove the risky part first** and keep each step small, testable, and
committed, so bugs can't pile up invisibly.

## The golden rules of this build

1. **One phase at a time.** Don't start a phase until the previous one works on the real TV/phone.
2. **Every phase ends the same way:** it runs locally, you test it, you `git commit` (a local
   snapshot), and (from Phase 0 on) you redeploy with `npx vercel --prod`. A phase isn't "done"
   until it's committed and live. (No GitHub in the loop — git is local snapshots, Vercel CLI deploys.)
3. **Test the casting on the actual Apple TV constantly.** The Lounge API is unofficial — a thing
   that worked yesterday can break. Catch it early, not after you've built 5 features on top.
4. **If Claude Code starts sprawling** (touching lots of files, adding features you didn't ask for),
   stop it and say "just do X, nothing else." Small diffs = few bugs.

Each phase below has a **Goal**, a **Definition of done**, and a **ready-to-paste prompt** for
Claude Code. Paste the prompt, test the result, commit, then move on.

**Current status: Phases 0–9 done and deployed.** The app has curated feeds + category tabs + live
badges, persistent TV pairing with tiered reconnect, Play Now / Queue Next, a PWA install, a
read-only now-playing status reader, and a Spotify-style now-playing bar (mini + full-screen:
play/pause, skip ±10s, next, drag-to-seek scrubber, and the Debate Companion chapter list). **Phase
10 (Hardening) is the remaining planned work.** An optional Debate Companion Tier 2 (AI topic
grouping / transcript summaries) is out of scope until explicitly requested.

---

## Phase 0 — Skeleton + pipeline (get to "deployed" immediately) ✅ done

**Goal:** A blank Next.js app, in git, live on Vercel, before writing any real features. This proves
your deploy pipeline works so it's never a mystery later.

**Definition of done:** `npm run dev` shows a page locally; the same page is live at your
`*.vercel.app` URL; `git log` shows your first commit.

> **Paste to Claude Code:**
> "Scaffold a new Next.js app in this folder using the App Router and TypeScript, with Tailwind CSS
> and ESLint. Add lucide-react. Replace the default homepage with a simple dark-mode page that says
> 'TV Guide — setup working'. Create a `.gitignore` that ignores `.env.local` and `node_modules`.
> Then show me the exact terminal commands to run it locally and to initialize git. Do not add any
> other features yet."

After it works locally, commit (`git add -A && git commit -m "Phase 0: scaffold"`) and deploy from
the terminal with `npx vercel` — no GitHub or Vercel website needed. Confirm the `.vercel.app` URL
loads on your phone.

---

## Phase 1 — THE SPIKE: prove you can cast to the TV (most important phase) ✅ done

**Goal:** Pair with the Apple TV using the "Link with TV code" and make **one hardcoded video**
play on the TV from your phone. Ugly is fine. No feeds, no tabs, no styling. This is the make-or-break
test of the whole app idea — do it before building anything pretty.

**Why first:** If Lounge casting doesn't work with your TV, you want to know now, not after a week
of UI work.

**Definition of done:** On the Apple TV, open YouTube > Settings > Link with TV code, type that code
into your app, tap one button, and a specific YouTube video **starts playing on the TV.**

> **Paste to Claude Code:**
> "Read CLAUDE.md, especially the Architecture and Lounge Protocol sections. Build the minimum needed
> to cast one hardcoded video to a TV via the YouTube Lounge API. Specifically:
> 1. `lib/lounge/client.ts` (server-only): functions to (a) pair using a 'Link with TV code'
>    (`get_screen` -> screen_id, then `get_lounge_token_batch` -> lounge_token), and (b) send a
>    `setPlaylist` command that plays a given videoId on the paired screen via the bind endpoint.
> 2. `app/api/tv/pair/route.ts`: POST { code } -> { screenId, token }.
> 3. `app/api/tv/command/route.ts`: POST { screenId, token, videoId } -> plays that video.
> 4. A bare-bones page: an input for the TV code + a 'Pair' button, and once paired, a single
>    'Play test video' button that plays videoId `dQw4w9WgXcQ`.
> Keep all Lounge logic server-side. No styling beyond making it usable. Explain how to get the TV
> code and test this, and warn me this is the fragile unofficial part so I test it on the real TV
> before we build further."

Test it repeatedly. **Do not proceed until a video reliably plays on the TV.** Commit when it works.

*(If pairing works but commands don't, that's the bind-session encoding — have Claude Code focus only
on `lib/lounge/client.ts`'s command function and iterate there.)*

---

## Phase 2 — Real feed from ONE channel (Data API) ✅ done

**Goal:** Fetch recent uploads from a single channel via the YouTube Data API and show them as a plain
list. Wire "Play Now" so tapping a real video plays it on the TV (reusing Phase 1's command route).

**Definition of done:** The app shows a list of real, recent videos from one channel; tapping one
plays it on the TV.

> **Paste to Claude Code:**
> "Now add the data layer for ONE channel. Per CLAUDE.md's quota rules, fetch recent uploads via the
> channel's uploads playlist (`channels.list` + `playlistItems.list`), NOT `search.list`. Read the
> API key from `process.env.YOUTUBE_API_KEY`.
> 1. `lib/channels.ts`: a config array; start with just one channel by its @handle.
> 2. `lib/youtube.ts`: helper to resolve a handle to its uploads playlist and fetch the latest ~15
>    uploads (title, videoId, thumbnail, channel name, duration if available).
> 3. `app/api/feed/route.ts`: GET returns that channel's recent uploads as JSON, cached/revalidated
>    every ~10 minutes.
> 4. Update the homepage to fetch `/api/feed` and render a plain list, each item with a 'Play Now'
>    button that calls the existing command route with that videoId.
> Handle loading and error states. Don't build tabs or styling yet."

Add `YOUTUBE_API_KEY` to `.env.local` locally, and to Vercel from the terminal with
`npx vercel env add YOUTUBE_API_KEY` (select Production, Preview, Development), then redeploy with
`npx vercel --prod`. Commit when it works.

---

## Phase 3 — All channels, tabs, live badges, unified feed ✅ done

**Goal:** Add all the real channels, group them into category tabs, add a combined "Unified Feed"
sorted by date, and mark live streams with a red LIVE badge.

**Definition of done:** Tabs switch between channel groups; unified feed merges them by date; live
streams show a LIVE badge.

> **Paste to Claude Code:**
> "Expand to the full channel set and add tabs. In `lib/channels.ts`, define the tab groups
> (each tab = a label + emoji + one or more channel handles). Update `app/api/feed/route.ts` to
> accept a tab param and return that tab's merged, date-sorted videos; add a 'unified' option that
> merges all channels. Add live-stream detection per CLAUDE.md (search.list eventType=live, used
> sparingly and cached) and include an `isLive` flag. Build a `ChannelTabs` component and a plain
> list per tab. Videos flagged `isLive` get a red 'LIVE' badge. Keep styling minimal for now —
> function first."

The exact channel handles depend on the questions in the chat message (which WWE/AEW channels, etc.).
Fill `lib/channels.ts` once those are settled. Commit when tabs + live badges work.

---

## Phase 4 — Senior-friendly UI polish ✅ done

**Goal:** Make it look and feel right for the actual user: big targets, high-contrast dark mode,
clean cards, clear Play Now / Queue Next buttons. Add the "Connected to Apple TV" green indicator
and the pairing modal.

**What shipped:**
- `components/VideoCard.tsx`: thumbnail (+ LIVE badge), title, channel/duration, and two stacked
  56px buttons — Play Now (`Play` icon) and Queue Next (`ListPlus` icon).
- `components/PairingModal.tsx`: the code-entry onboarding, extracted from the old inline form.
- `components/ConnectionStatus.tsx`: green/grey pill, shown above both the pairing and paired
  views.
- **Queue Next** is new Lounge surface: `queueVideo()` in `lib/lounge/client.ts` sends an `addVideo`
  command (reconstructed from community reverse-engineering, not official docs — same
  unofficial-API caveat as everything else in `lib/lounge/`). `app/api/tv/command/route.ts` now
  takes a `command: "play" | "queue"` field and reuses the existing tiered reconnect fallback for
  both. **Confirmed working on the real TV.**
- `app/globals.css`: `html { font-size: 18px }` so Tailwind's rem-based text utilities meet
  CLAUDE.md's base-font-size rule site-wide.
- Persistent pairing (`lib/storage.ts`, the reconnect tiers) was pulled forward earlier and is
  unchanged by this phase — `ConnectionStatus` just reflects that existing state.

**Definition of done:** It looks clean and is comfortably usable one-handed on a phone by a senior;
a green status shows when paired; Queue Next works.

Commit after the UI feels right on your phone.

---

## Phase 5 — Floating remote control bar ✅ done (its RemoteBar was later replaced by NowPlayingBar in Phase 9)

**Goal:** A collapsible bottom bar: play/pause, skip +/-10s, next in queue, and the current video
title. Start with the buttons that are just "send a command" (easy); add now-playing status carefully.

**Definition of done:** The remote bar's play/pause/skip/next buttons control the TV. Now-playing
title shows the current video (best-effort).

> **Paste to Claude Code:**
> "Add a collapsible floating `RemoteBar` at the bottom with: Play/Pause toggle, Skip Back 10s,
> Skip Forward 10s, Next Video, and a text area for the current video title. Add the corresponding
> Lounge commands (play, pause, seekTo relative, next) to the client and command route — these are
> short 'fire-and-forget' commands, keep them simple.
> For the now-playing title, follow CLAUDE.md's serverless note: implement a `app/api/tv/status`
> route that fetches ONE event batch with a short timeout and returns fast, and have the client
> poll it every few seconds — do NOT open a long-lived listener. If now-playing status is flaky,
> leave the title blank rather than blocking the app."

Commit when the remote controls the TV reliably.

---

## Phase 6 — PWA (add to home screen) ✅ done

**Goal:** Make it installable to the iPhone/iPad home screen so it opens like an app, full-screen.

**Definition of done:** On the iPhone, Safari > Share > Add to Home Screen produces an icon that
opens the app full-screen in dark mode.

> **Paste to Claude Code:**
> "Make this a PWA optimized for iOS home-screen install. Add `public/manifest.json` (name, dark
> theme color, standalone display, app icons), the icon set in `public/icons/`, and the required
> Apple-specific meta tags in the layout (apple-mobile-web-app-capable, status bar style,
> apple-touch-icon). Keep it a lightweight PWA — a manifest + icons + meta tags. Don't add a heavy
> service-worker/offline framework unless I ask."

Test the actual 'Add to Home Screen' flow on the phone. Commit.

---

## Phase 7 — Debate Companion ✅ done

**Goal:** Give the chapter/timestamp markers already in many videos' descriptions (common on
debate, news, and panel-show uploads) a senior-friendly UI: parse them and let the user tap a
chapter to jump the Apple TV straight there, reusing the existing `seekTo` Lounge command.

**Definition of done:** Selecting a video that has chapter timestamps in its description shows a
vertical list of large, tappable chapter buttons (e.g. "14:20 — Foreign Policy"); tapping one
jumps the real TV to that point in the video within a couple of seconds. Videos with no parseable
timestamps show nothing extra — no broken or empty UI.

**What shipped:** `lib/chapters.ts` (pure `parseChapters`/`formatTimestamp`, no network calls),
`app/api/chapters/route.ts` (GET `?videoId=`, fetches `videos.list?part=snippet` and returns
parsed chapters, cached like the feed route), and `components/DebateCompanion.tsx` (fetches
chapters for the selected video, renders them, calls the existing `seek` command with each
chapter's absolute seconds). Wired into `app/page.tsx` via a new `selectedVideoId` state — tapping
a video's thumbnail/title (a small addition to `VideoCard.tsx`) selects it and mounts
`DebateCompanion` beneath it. None of `lib/lounge/`, `app/api/tv/command/route.ts`,
`lib/youtube.ts`, or `app/api/feed/route.ts` were modified — `seekTo` already takes an absolute
time in seconds, so no new Lounge surface was needed.

**Relocated in Phase 9:** the chapters were originally wired into the feed (tapping a `VideoCard`
selected it and showed the list beneath). That feed wiring was removed — `VideoCard` is a plain card
again — and `DebateCompanion` now renders inside the now-playing bar's expanded view, keyed to the
currently-playing video. The component, `lib/chapters.ts`, and `app/api/chapters/route.ts` are
unchanged; only where it's mounted changed.

**Out of scope for now (optional future Tier 2):** AI-assisted topic grouping and transcript
summaries. That would need an `ANTHROPIC_API_KEY` and an unofficial YouTube transcript-fetching
library, both bigger asks than this phase — don't start it until explicitly requested.

---

## Phase 8 — Now-playing status reader (Tier 1, read-only) ✅ done

**Goal:** A server-side reader that reports what the TV is currently doing (playing/paused, position,
duration) so the UI can show a live now-playing bar — **without** a persistent listener
(serverless-safe) and **without** touching the fragile command path.

**Definition of done:** `GET /api/tv/nowplaying` returns a status the UI can trust — `now_playing`
(with position/duration), `stopped`, or `no_update` — never hangs, never throws, and never interferes
with Play/Pause/Seek. Verified on the real TV, including pause/resume from the physical Apple TV remote.

**What shipped:** `lib/lounge/status.ts` (a pure GET-only bind-channel reader) and
`app/api/tv/nowplaying/route.ts`, plus a temporary debug page `app/debug/now-playing/page.tsx` (not
linked from the app) that dumps the parsed + raw values.

**Hard-won protocol findings (this is why it took real investigation — full detail lives in CLAUDE.md's
"Now-playing status" subsection):**
- The Lounge back channel is **not** a long-poll — the server sends one short batch and **closes in
  ~0.5s**, so the reader must **reconnect repeatedly** within a bounded ~8s budget.
- **Steady-state playback emits NO events**; the TV emits only on **transitions** (play/pause/seek/
  load/stop). A probe that catches nothing therefore means **"no change" (`no_update`), NOT "nothing
  playing"** — conflating those is the flicker bug.
- `onStateChange` carries position/duration/state but **never videoId/title**; videoId rides only the
  one-time `nowPlaying` event. So the UI resolves title/thumbnail from the app's own feed.
- The reader is **GET-only and never touches the bind `ofs` counter**, so it cannot break casting.

**Out of scope (deliberately):** an active `getNowPlaying` query (would give live steady-state position
+ videoId on demand) — it's a forward-channel POST that contends with the command `ofs` counter, so
it's only safe as a *single on-demand* request threaded through the client's counter, never a
background poller. Left as a documented future option (see `status.ts` comments / CLAUDE.md).

---

## Phase 9 — Spotify-style now-playing bar (+ scrubber; chapters relocated) ✅ done

**Goal:** Replace the old floating RemoteBar popup with a single Spotify-style now-playing bar — a
collapsed mini-bar and a full-screen expanded view — driven by the Phase 8 status reader and the
existing commands.

**Definition of done:** Exactly **one** bottom bar. Collapsed: thumbnail + title + channel + a
play/pause button whose icon reflects the **actual reported** play state (a physical-remote pause
flips it); tapping elsewhere opens the full-screen view. Expanded: large artwork, title/channel, a
**drag-to-seek scrubber** with time labels, controls (skip back 10s, play/pause, skip forward 10s,
next), the chapter list, and chevron/swipe-down to dismiss. The bar shows only while something is
playing and hides on stop; it never covers the feed when hidden. Respects iOS safe-area insets.

**What shipped:** `components/NowPlayingBar.tsx` (new), replacing `components/RemoteBar.tsx` (deleted).
It polls `/api/tv/nowplaying` and reuses `sendTvCommand` → `/api/tv/command` for **every** button —
no new remote logic. `app/page.tsx` tracks `currentVideoId` (set on Play Now) and passes a
`videosById` metadata map so the bar shows title/channel/thumbnail (status videoId is usually null).
The scrubber's range-input styling lives in `app/globals.css`. Position advances via a local ~500ms
tick over the Phase 8 extrapolation, re-anchored at transitions and on user commands (so the scrubber
and Skip ±10s can compute an absolute `seek` target). The **Debate Companion chapters moved here**
from the feed (see Phase 7's relocation note).

**Reuse guarantees:** no changes to `lib/lounge/client.ts`, `app/api/tv/command/route.ts`,
`lib/lounge/status.ts`, `app/api/tv/nowplaying/route.ts`, `lib/youtube.ts`, or the feed. Every control
maps to an existing command; the scrubber and Skip ±10s use `seek` with an absolute target.

**Known, by-design caveat:** between transitions the scrubber position is locally extrapolated, so it
can drift on un-signaled TV stalls/ads; it self-corrects at the next transition or user seek. This is
the Option-1 tradeoff chosen in Phase 8 to keep the status reader from endangering casting commands.

---

## Phase 10 — Hardening (do this once it's in daily use)

**Goal:** Make it robust for a non-technical user: friendly errors, token-expiry recovery, quota
resilience, empty/failed feed handling.

> **Paste to Claude Code:**
> "Now harden the app for a non-technical daily user. Add: friendly error + retry UI for any failed
> feed or command; automatic lounge-token refresh from the stored screenId when a command returns an
> auth error (only fall back to re-pairing if the screenId is dead); graceful handling when a feed
> is empty or the Data API quota is exceeded (show a clear message, keep the last good data if
> possible). Don't change working behavior — only add resilience around the edges."

---

## Quick reference: the loop for every phase

1. Paste the phase prompt into Claude Code.
2. Let it make the change; read its summary.
3. `npm run dev` and test locally on your phone (and the TV for casting phases).
4. If it's wrong, describe exactly what's wrong; iterate in small steps.
5. When it works: `git add -A && git commit -m "phase N: ..."` (local snapshot).
6. Redeploy with `npx vercel --prod` and confirm the live URL works.
7. Only then start the next phase.
