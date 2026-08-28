<h1 align="center">TV Guide</h1>

<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="TV Guide icon" />
</p>

<p align="center">
  <b>A phone-sized YouTube remote for the Apple TV.</b><br />
  Browse your real YouTube subscriptions on your iPhone, tap once, and it plays on the TV.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white" />
  <img alt="Vercel" src="https://img.shields.io/badge/Deployed-Vercel-000?logo=vercel&logoColor=white" />
</p>

---

## Why this exists

The YouTube app on a smart TV is genuinely hard to use if you're not comfortable with a
directional remote: search means pecking at an on-screen keyboard, the home screen is a wall of
recommendations, and finding "that channel I watch every night" takes a dozen clicks.

TV Guide replaces the remote. It's a web app you open on your **phone** — install it to the home
screen and it behaves like a native app — that shows the channels you actually subscribe to as a
clean, scrollable list of big thumbnails. You tap a video, it starts on the TV. A Spotify-style
now-playing bar handles play/pause, skipping, seeking, and jumping to chapters.

It was built for one specific person: a parent who watches long-form news and debate videos on an
Apple TV. That single-user brief drove every design decision below.

## What it does

| | |
|---|---|
| **Sign in with Google** | The feed is *your* YouTube subscriptions (`youtube.readonly`), not a hardcoded channel list. |
| **Home** | Recent uploads merged across **all** your subscriptions, newest first. |
| **Your Channels** | A large dropdown of your subscribed channels; pick one to see just its uploads. |
| **Queued** | What you've lined up this session, with one-tap removal. |
| **Play Now / Queue Next** | One tap sends the video to the TV over YouTube's TV-code pairing. |
| **Now-playing bar** | Mini bar + full-screen view: play/pause, skip ±10s, next, drag-to-seek scrubber. |
| **Chapter jumps** | Timestamps parsed out of the video description become tappable seek targets. |
| **Live** | Currently-live streams surface with a pulsing red LIVE badge. |
| **PWA** | Installs to the iOS home screen; safe-area aware; dark, high-contrast, 48px+ touch targets. |

Pairing is one-time: enter the code from the TV's **Settings → Link with TV code** once, and the
session persists in `localStorage` across reloads.

## Tech stack

- **Next.js 16 (App Router)** + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** for all styling, **lucide-react** for icons
- **YouTube Data API v3** for feeds, **Google OAuth 2.0** for subscriptions
- **YouTube Lounge API** (unofficial, reverse-engineered) for TV playback control
- Deployed on **Vercel**; zero runtime dependencies beyond the four above

## How it works

### The core constraint: the browser can't talk to YouTube

Neither half of this app can run client-side. The Data API key would be exposed in the bundle, and
the Lounge endpoints (`www.youtube.com/api/lounge/...`) send **no CORS headers**, so browser fetches
to them are blocked outright.

So everything goes through our own server-side Route Handlers running as Vercel functions. The
browser only ever talks to `/api/*` on our own origin, and secrets never leave the server.

```
   iPhone / PWA
        │  fetch → our own /api/* only
        ▼
  Next.js Route Handlers (Vercel)      ← API key, OAuth secret, cookie key live here
        │
        ├── YouTube Data API v3  ── feeds: subscriptions, uploads, live
        └── YouTube Lounge API   ── pairing + playback commands → Apple TV
```

### Casting: the Lounge protocol

Casting is built on the same undocumented protocol YouTube's own mobile app uses to drive a TV:

1. The TV displays a pairing code. We exchange it for a durable **`screen_id`**.
2. The `screen_id` gets us a **`lounge_token`**.
3. Commands (`setPlaylist`, `addVideo`, `play`, `pause`, `next`, `seekTo`) are POSTed into a
   **bind session** riding Google's BrowserChannel wire protocol.

Two things about this were the hard part:

**The `ofs` counter.** Every POST to the bind channel carries `ofs` — a running count of messages
already sent on that session. Get it wrong and the server does not return an error: it returns
`200 OK` and *silently drops the message*. The TV just… doesn't respond. The session's `rid`/`ofs`
counters are therefore threaded through every request/response round-trip and mirrored into
`localStorage`, since serverless functions hold no memory between invocations.

**Three-tiered recovery.** Tokens expire and sessions go stale, and the original build made you
re-pair the TV constantly. Now a failed command escalates: retry on a fresh bind session → re-mint
the token from the stored `screen_id` → and only if *that* fails does it clear storage and ask for a
new TV code. In practice you pair once and never think about it again.

### Reading "now playing" without a persistent connection

Serverless functions can't hold a socket open, so a long-lived listener was off the table. Tracing
the back channel against a real Apple TV turned up why that's fine — and why a naive implementation
flickers:

- The bind read channel is **not** a stream. It sends one short batch and closes in ~0.5s, even
  mid-playback. The reader makes bounded quick reconnects inside an ~8s budget and returns.
- **Steady playback emits no events at all.** A 20s trace during untouched playback caught 15
  reconnects and zero playback events. The TV only speaks on *transitions*: play, pause, seek, load,
  stop.
- So the reader returns **three** states, not two: `now_playing`, `stopped`, and `no_update`.
  `no_update` means "caught nothing this probe" — the UI must **retain** its last known state.
  Treating it as "nothing playing" is exactly the flicker bug that took the longest to kill.

The playhead is therefore **extrapolated locally**: the TV supplies a position *anchor* at each
transition, and the client ticks a timer between them, re-anchoring on the next event or user
command. That's what makes the scrubber and skip ±10s feel instant.

The status reader is deliberately **GET-only**. It never POSTs, so it never touches the `ofs`
counter the commands depend on — meaning the thing that reads state structurally cannot break the
thing that sends commands.

### Subscriptions and OAuth

The feed is the user's real subscription list, fetched with `youtube.readonly`. Notably this is
**not** YouTube's recommendation algorithm — no public API exposes that anymore, and the only route
to it is scraping the internal InnerTube API with logged-in cookies, which is ToS-violating and
account-risky. Recent uploads from channels you chose to subscribe to turned out to be a better fit
for the use case anyway.

Security and quota shaped the implementation:

- The refresh token lives **only** in an AES-256-GCM encrypted `httpOnly` cookie — never
  `localStorage`, never a `NEXT_PUBLIC_*` var. OAuth is plain `fetch` + `node:crypto`, no new deps.
- OAuth'd Data API calls are forced to `cache: "no-store"` so user-private data can never enter
  Next's shared response cache. Public by-channel feeds keep their cache.
- The Data API allots 10,000 units/day. Uploads are fetched via the channel's uploads playlist
  (1 unit) rather than `search.list` (100 units); live detection is cached; and the Home feed is
  fetched once per connection and held in state rather than refetched on every tab switch.

### Design rules

Written for someone with reading glasses and low patience for clutter, then dressed in a modern
shell:

- Minimum touch target **48×48px**, 56px+ for primary actions
- Base font ≥18px, high-contrast dark mode by default
- No nested modals, no horizontal scrolling, every screen usable one-handed
- A single accent red (`#EF4444`) sampled from the app icon, used only for primary/active affordances

## Project structure

```
app/
  page.tsx                    # app shell: pairing, 3 pages, nav + now-playing bar, all shared state
  api/
    feed/                     # one channel's uploads + live (public, API key)
    subscriptions/            # subscribed channels (OAuth)
    subscriptions/feed/       # Home: uploads merged across all subscriptions (OAuth)
    chapters/                 # chapter list for a video
    auth/youtube/             # login → consent, callback → encrypted cookie, logout
    tv/pair | command |       # Lounge: pair with TV, send commands,
       nowplaying | reconnect #   read status, re-mint token
lib/
  lounge/client.ts            # pairing, bind sessions, command encoding (server-only)
  lounge/status.ts            # read-only, GET-only now-playing reader (server-only)
  youtube.ts                  # Data API helpers; OAuth vs API-key call split
  googleAuth.ts               # OAuth flow + AES-256-GCM cookie crypto (node:crypto)
  chapters.ts                 # pure timestamp parser, no network
  storage.ts                  # localStorage helpers for the TV session (client-only)
components/
  BottomNav · ChannelPicker · ConnectYouTube · ConnectionStatus
  VideoCard · NowPlayingBar · DebateCompanion · PairingModal
```

All Lounge logic is confined to `lib/lounge/` and `app/api/tv/` — the protocol is unofficial and can
break without warning, so it stays fixable in one place and never leaks into UI components.

## Running it locally

**Prerequisites:** Node 20+, a Google Cloud project with the **YouTube Data API v3** enabled, and an
Apple TV (or any device running the YouTube TV app) on your network.

```bash
git clone https://github.com/KaskasR/tv-guide.git
cd tv-guide
npm install
cp .env.example .env.local   # then fill it in, see below
npm run dev                  # http://localhost:3000
```

Environment variables — all server-only, never prefixed `NEXT_PUBLIC_`:

| Variable | What it's for |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key — feeds and chapters |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth "Web application" client, same GCP project as the key |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Server-only; never commit |
| `OAUTH_TOKEN_SECRET` | Random 32+ chars (`openssl rand -base64 32`) — encrypts the refresh-token cookie |

Add `http://localhost:3000/api/auth/youtube/callback` (and the production equivalent) as authorized
redirect URIs on the OAuth client. Publish the consent screen to **Production** — unverified is fine,
you just get a one-time warning — because in "Testing" mode Google expires the refresh token every
7 days.

To pair a TV: open the YouTube app on the Apple TV → **Settings → Link with TV code**, and enter the
code in the app.

```bash
npm run dev      # local dev
npm run build    # production build
npm run lint     # eslint
```

## Deploying

Deploys run through **GitHub → Vercel**:

- push to `main` → production deploy
- push a branch / open a PR → isolated preview deploy

The four environment variables above live in the Vercel project settings and apply to every
deployment.

## Notes and limitations

- **The Lounge API is unofficial.** It's reverse-engineered from community work and YouTube's own
  clients, and can change without notice. Everything touching it is isolated accordingly.
- **The queue is a client-side mirror,** not a live read of the TV's real queue — the protocol can't
  be read back reliably. It prunes a video when that video starts playing and resets on reload, so a
  stale list can't linger. Videos queued from the TV's own remote won't appear.
- Built for a single household user, so there's no multi-user or multi-TV support.

## License

Personal project, published for reference. Not affiliated with, endorsed by, or supported by YouTube
or Google.
