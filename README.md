# TV Guide

A YouTube TV guide + remote control, built for one senior/parent user watching on an Apple TV. On an
iPhone/iPad, sign in with Google and browse your real subscriptions across a Spotify-style three-page
shell — **Home** (all your subscriptions merged), **Your Channels** (pick one subscribed channel),
and **Queued** — then tap a video to Play Now or Queue Next on the TV via YouTube's "Link with TV
code" pairing. A Spotify-style now-playing bar (mini + full-screen, with a drag-to-seek scrubber and
chapter jumps) controls playback.

See [`CLAUDE.md`](./CLAUDE.md) for architecture, constraints, and conventions, and
[`BUILD_PLAN.md`](./BUILD_PLAN.md) for the phased build plan and per-phase detail.

## Status

**Phases 0–9 + 11–13 done and deployed; Phase 10 (hardening) remains.** Highlights:

- **Casting (Lounge API):** TV-code pairing + `setPlaylist`/`addVideo` (Play Now / Queue Next),
  confirmed on the real Apple TV, with persistent pairing in `localStorage` and tiered token/session
  reconnect (see the `ofs` and recovery gotchas in `CLAUDE.md`).
- **Subscription-driven feeds (Phases 12–13):** signed-in via Google OAuth (`youtube.readonly`),
  Home merges recent uploads across **all** your subscriptions and Your Channels picks one subscribed
  channel (`?channelId=`); live streams get a red LIVE badge via a cached `search.list` check. Not
  the recommendation algorithm (no stable API exists); the refresh token lives only in an encrypted
  httpOnly cookie. Needs the `GOOGLE_OAUTH_*` / `OAUTH_TOKEN_SECRET` env vars.
- **Now-playing:** a read-only, GET-only status reader (`/api/tv/nowplaying`) drives the Spotify-style
  `NowPlayingBar` (play/pause, skip ±10s, next, drag-to-seek scrubber, Debate Companion chapters).
- **App shell (Phase 11):** `BottomNav` with Home / Your Channels / Queued, logo-red accent
  (`#EF4444`), and a session-only, auto-pruning queue mirror on the Queued page.
- **PWA:** installable to the iOS home screen (manifest + icons + Apple meta tags).

## Getting started

```bash
npm run dev        # local dev at http://localhost:3000
npm run build       # production build
npm run lint         # eslint
```

Copy `.env.example` to `.env.local` and fill in `YOUTUBE_API_KEY` (needed for the feed).

## Deploy

```bash
npx vercel          # first deploy / preview
npx vercel --prod   # production deploy
```

No GitHub integration — git is used for local commit snapshots only; deploys go straight from the
terminal via the Vercel CLI.
