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
- **Phase 2 — Real feed from one channel (Data API):** next up.

## Getting started

```bash
npm run dev        # local dev at http://localhost:3000
npm run build       # production build
npm run lint         # eslint
```

Copy `.env.example` to `.env.local` and fill in `YOUTUBE_API_KEY` once Phase 2 needs it.

## Deploy

```bash
npx vercel          # first deploy / preview
npx vercel --prod   # production deploy
```

No GitHub integration — git is used for local commit snapshots only; deploys go straight from the
terminal via the Vercel CLI.
