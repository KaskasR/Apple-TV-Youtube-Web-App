# TV Guide

A curated YouTube TV guide + remote control, built for one senior/parent user watching on an
Apple TV. Browse recent uploads and live streams from favorite channels on an iPhone/iPad, then
tap a video to Play Now or Queue Next on the TV via YouTube's "Link with TV code" pairing.

See [`CLAUDE.md`](./CLAUDE.md) for architecture, constraints, and conventions, and
[`BUILD_PLAN.md`](./BUILD_PLAN.md) for the phased build plan and current status.

## Status

- **Phase 0 — Skeleton + pipeline:** done. Blank Next.js app, deployed to Vercel.
- **Phase 1 — Cast spike (Lounge API):** done. Pairing via TV code + `setPlaylist` casting works,
  reusing one bind session across commands.
- **Phase 2 — Real feed from one channel (Data API):** done. Real uploads from `@zeteo` render as a
  list with working Play Now buttons; also fixed a bind-session bug where reused-session commands
  were silently dropped (see the `ofs` gotcha in `CLAUDE.md`).
- **Phase 3 — All channels, tabs, live badges:** done. News (`@zeteo`) and Sports
  (`@volleyballworld`, `@RogerThatTennis`) tabs, plus a date-sorted Unified tab; live streams get a
  red LIVE badge via a cached `search.list` check per channel.
- **Persistent TV pairing** (pulled forward from Phase 4): done. The paired session lives in
  `localStorage` (`lib/storage.ts`), so reloading the app no longer requires re-entering the TV
  code; an expired lounge token is silently re-minted from the stored screen ID, and the pairing
  form only reappears if the TV itself unlinks.
- **Phase 4 — Senior-friendly UI polish:** done. Real `VideoCard`s (Play Now + Queue Next),
  `PairingModal`, and a `ConnectionStatus` indicator; 18px base type. Queue Next uses a new,
  unverified Lounge command (`addVideo`) — needs testing on the real TV.
- **Phase 5 — Floating remote control bar:** next up.

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
