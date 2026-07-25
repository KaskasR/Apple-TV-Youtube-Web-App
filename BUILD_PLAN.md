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

---

## Phase 0 — Skeleton + pipeline (get to "deployed" immediately)

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

## Phase 1 — THE SPIKE: prove you can cast to the TV (most important phase)

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

## Phase 2 — Real feed from ONE channel (Data API)

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

## Phase 3 — All channels, tabs, live badges, unified feed

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

## Phase 4 — Senior-friendly UI polish

**Goal:** Make it look and feel right for the actual user: big targets, high-contrast dark mode,
clean cards, clear Play Now / Queue Next buttons. Add the "Connected to Apple TV" green indicator
and the pairing modal.

**Definition of done:** It looks clean and is comfortably usable one-handed on a phone by a senior;
a green status shows when paired; Queue Next works.

> **Paste to Claude Code:**
> "Now do the visual design, following the 'Who it's for' rules in CLAUDE.md (min 56px primary touch
> targets, base font >= 18px, high-contrast dark mode, no clutter). Build:
> 1. `VideoCard`: large thumbnail, big readable title, channel name, duration, and two big buttons —
>    'Play Now' (play icon) and 'Queue Next' (plus icon). Add a `queueNext` command to the Lounge
>    client and command route.
> 2. `PairingModal`: onboarding to enter the TV code, shown when not yet paired.
> 3. `ConnectionStatus`: a green 'Connected to Apple TV' indicator when a screenId is stored, grey
>    when not.
> Persist screenId + token in localStorage via `lib/storage.ts`, and per CLAUDE.md, re-mint an
> expired token from the stored screenId automatically instead of forcing re-pairing.
> Change nothing about the data-fetching or Lounge command logic that already works."

Commit after the UI feels right on your phone.

---

## Phase 5 — Floating remote control bar

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

## Phase 6 — PWA (add to home screen)

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

## Phase 7 — Hardening (do this once it's in daily use)

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
