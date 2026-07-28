import type { BindSession } from "@/lib/lounge/client";

// Deliberately self-contained — does not import bind/parsing internals from lib/lounge/client.ts
// (they're private to that file, and per the now-playing task this is meant to be a fresh,
// isolated read path, not a reuse of the flaky Phase 5 attempt). Only the BindSession *type* is
// shared, since a status read rides the same already-open bind session as commands do.
const LOUNGE_BASE = "https://www.youtube.com/api/lounge";
// Each individual GET listen attempt gets this long before we give up on it and reconnect.
const PER_ATTEMPT_TIMEOUT_MS = 3000;
// Total wall-clock budget for fetchNowPlayingBatch across all reconnect attempts. Still a single
// bounded, request-scoped operation, not a persistent listener — it just makes several quick
// hops instead of one, since in practice the server closes each connection right after a single
// "noop" heartbeat rather than holding it open for a real event. Comfortably under any
// serverless function's max duration.
const TOTAL_BUDGET_MS = 8000;
// Skip firing another attempt once less than this much budget remains — too little time for a
// real round trip, just a doomed request that adds noise to the error message.
const MIN_ATTEMPT_MS = 800;

// Three-way result — the distinction matters, and conflating the last two was the core "flicker
// back to nothing playing" bug. Against the real TV, steady-state playback emits NO events at all
// (confirmed by a 20s trace: 15 reconnects, all noop, zero events); the TV only emits on
// transitions (play/pause/seek/load/stop). So a probe that catches nothing does NOT mean nothing
// is playing — it means "no change, keep showing what you had". Only an explicit ended/unstarted
// state means playback actually stopped.
export type NowPlayingStatus =
  // No playback event observed this probe. The caller should RETAIN its last known state (and,
  // for a video it started itself, extrapolate position with a local timer) — do not treat this
  // as "nothing is playing".
  | { kind: "no_update" }
  // The TV explicitly reported ended/unstarted (state 0 / -1) — playback really did stop.
  | { kind: "stopped" }
  | {
      kind: "now_playing";
      // videoId/title ride only the one-time "nowPlaying" event (fired at load), never the
      // routine "onStateChange" updates — confirmed against the real TV. So during steady
      // playback these are usually null here; the UI resolves the title from its own feed list
      // (the videoId it told the TV to play), the way RemoteBar already does.
      videoId: string | null;
      title: string | null;
      isPlaying: boolean;
      // The TV only hands us a position ANCHOR at each transition — there are no periodic
      // position updates during steady playback. Between anchors the UI extrapolates locally.
      positionSeconds: number | null;
      durationSeconds: number | null;
    };

type BindPayload = [string, ...unknown[]];

// Same length-prefixed "bind"/BrowserChannel wire format as lib/lounge/client.ts's
// parseBindChunks — see that file's comment for the format. Duplicated here on purpose (see
// module comment above) rather than imported, since it isn't exported.
function parseBindChunks(text: string): BindPayload[] {
  const payloads: BindPayload[] = [];
  let offset = 0;
  while (offset < text.length) {
    const match = text.slice(offset).match(/^\s*(\d+)\n/);
    if (!match) break;
    offset += match[0].length;
    const length = parseInt(match[1], 10);
    const chunk = text.slice(offset, offset + length);
    offset += length;
    try {
      const parsed = JSON.parse(chunk) as [number, BindPayload][];
      for (const [, payload] of parsed) {
        payloads.push(payload);
      }
    } catch {
      // Malformed/partial chunk — keep scanning, not fatal for finding a nowPlaying event.
    }
  }
  return payloads;
}

// True if a batch contains an actual nowPlaying/onStateChange event. Real batches often also
// carry unrelated events (onHasPreviousNextChanged, onAudioTrackListChanged, etc.) that are
// neither noop nor playback-relevant — treating "got some event" as good enough to stop
// reconnecting was the bug that caused status to flicker back to "nothing playing" every few
// seconds even while a video kept playing, since those batches genuinely have no playback info
// to parse.
function containsPlaybackEvent(payloads: BindPayload[]): boolean {
  return payloads.some((payload) => payload[0] === "nowPlaying" || payload[0] === "onStateChange");
}

// nowPlaying/onStateChange event data comes through as an already-parsed object in practice
// (the outer JSON.parse in parseBindChunks deserializes nested structures too), but fall back to
// treating it as a JSON or URL-encoded "key=value&..." string in case of a different protocol
// version — same defensive approach as client.ts.
function parseEventFields(data: unknown): Record<string, string> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, string>;
  }
  if (typeof data !== "string") return {};

  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    // not JSON — fall through to query-string parsing
  }
  const fields: Record<string, string> = {};
  for (const pair of data.split("&")) {
    const [key, value] = pair.split("=");
    if (key) fields[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return fields;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Pure parser: given the raw decoded batch text from the bind channel's listen response, returns
// the current playback status. A batch with no nowPlaying/onStateChange event yields "no_update"
// (NOT "stopped") — that's the fix for the flicker bug, since steady playback legitimately emits
// no events. A single batch can contain several state updates (e.g. a buffering->playing
// transition) — this takes the LAST relevant one for state/position, since that's current, not
// the first. videoId/title only arrive on a "nowPlaying" event (confirmed against the real TV —
// routine "onStateChange" updates don't carry them), so those are carried forward within the
// batch rather than being wiped out by a later onStateChange that doesn't repeat them. Never
// throws — worst case it falls back to "no_update".
export function parseNowPlayingStatus(raw: string): NowPlayingStatus {
  const payloads = parseBindChunks(raw);
  let latest: NowPlayingStatus | null = null;
  let knownVideoId: string | null = null;
  let knownTitle: string | null = null;

  for (const [eventName, data] of payloads) {
    if (eventName !== "nowPlaying" && eventName !== "onStateChange") continue;

    const fields = parseEventFields(data);
    knownVideoId = fields.videoId || fields.video_id || knownVideoId;
    knownTitle = fields.title || fields.videoTitle || knownTitle;

    const stateCode = fields.state;
    // An event with no state field tells us nothing about play/stop — let it contribute its
    // videoId/title (carried above) but don't let it set the state result.
    if (stateCode === undefined) continue;

    // Lounge state codes (reverse-engineered): -1 unstarted, 0 ended, 1 playing, 2 paused,
    // 3 buffering, 5 cued. Only 0/-1 mean playback actually stopped.
    if (stateCode === "-1" || stateCode === "0") {
      latest = { kind: "stopped" };
      continue;
    }

    latest = {
      kind: "now_playing",
      videoId: knownVideoId,
      title: knownTitle,
      isPlaying: stateCode === "1",
      positionSeconds: toNumber(fields.currentTime),
      durationSeconds: toNumber(fields.duration),
    };
  }

  return latest ?? { kind: "no_update" };
}

function statusQueryParams(loungeToken: string, session: Pick<BindSession, "sid" | "gsessionid">): URLSearchParams {
  return new URLSearchParams({
    name: "TV Guide",
    app: "youtube-desktop",
    device: "REMOTE_CONTROL",
    VER: "8",
    CVER: "1",
    loungeIdToken: loungeToken,
    SID: session.sid,
    gsessionid: session.gsessionid,
    RID: "rpc",
    CI: "0",
    TYPE: "xmlhttp",
  });
}

export type FetchBatchResult = { ok: true; raw: string } | { ok: false; reason: string };

// Opens the bind channel's GET listen endpoint on an already-open session, reads whatever
// arrives within timeoutMs, then gives up. In practice the server closes the connection right
// after sending a single message (often just a "noop" heartbeat) rather than holding it open —
// so one attempt is fast, but frequently empty of real information. See fetchNowPlayingBatch,
// which loops this to actually catch a real event.
async function fetchOneListenAttempt(
  loungeToken: string,
  session: Pick<BindSession, "sid" | "gsessionid">,
  timeoutMs: number
): Promise<FetchBatchResult> {
  const query = statusQueryParams(loungeToken, session);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let buffer = "";

  try {
    const res = await fetch(`${LOUNGE_BASE}/bc/bind?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
    }
    if (!res.body) {
      return { ok: false, reason: "Response had no readable body" };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return { ok: true, raw: buffer };
  } catch (err) {
    // A partial batch buffered before the timeout fired is still useful to parse.
    if (buffer.length > 0) return { ok: true, raw: buffer };
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        reason: `No data received within ${timeoutMs}ms (idle channel timeout — the TV may just not have pushed an update in that window)`,
      };
    }
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : "Unknown fetch error";
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

// Loops fetchOneListenAttempt within a bounded total time budget (TOTAL_BUDGET_MS), reconnecting
// immediately whenever an attempt's batch has no nowPlaying/onStateChange event in it — whether
// that's because it was pure noop, or because it only carried unrelated events (audio track
// list, has-previous/next, etc.) — until either a real playback event turns up or the budget
// runs out. Still a single bounded, request-scoped read — per
// CLAUDE.md this must never become a persistent listener that outlives a serverless function —
// it just takes several quick hops instead of assuming one GET will catch something meaningful.
// Returns a discriminated result rather than a bare null so callers (and whoever is debugging
// this against the real TV) can tell an HTTP error apart from a network error apart from
// "nothing arrived" — very different failure modes that shouldn't collapse into one. Never
// throws.
export async function fetchNowPlayingBatch(
  loungeToken: string,
  session: Pick<BindSession, "sid" | "gsessionid">
): Promise<FetchBatchResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let lastResult: FetchBatchResult = {
    ok: false,
    reason: "No data received before the overall timeout",
  };

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    // Not enough budget left for a connection to plausibly round-trip — stop instead of firing
    // an attempt that's essentially guaranteed to time out (this is what produced confusing
    // "No data received within 150ms" style errors before this check existed).
    if (remaining < MIN_ATTEMPT_MS) break;

    const result = await fetchOneListenAttempt(
      loungeToken,
      session,
      Math.min(PER_ATTEMPT_TIMEOUT_MS, remaining)
    );
    lastResult = result;

    if (!result.ok) {
      // An HTTP error (e.g. a stale/unknown SID) won't be fixed by reconnecting with the same
      // session — stop immediately instead of burning the rest of the budget repeating it.
      if (result.reason.startsWith("HTTP ")) return result;
      continue;
    }

    if (!containsPlaybackEvent(parseBindChunks(result.raw))) continue;
    return result;
  }

  return lastResult;
}

// Composes fetchNowPlayingBatch + parseNowPlayingStatus into a single NowPlayingStatus. On any
// connection failure/timeout it returns { kind: "no_update" } rather than throwing or returning
// null — an unreachable TV or an empty probe window should just leave the caller's last known
// state intact, never blank the UI. (An explicit stop still comes back as { kind: "stopped" }.)
//
// NOTE for a future scrub-bar / cold-start refresh: this stays a pure GET-only reader — it never
// POSTs to the forward channel, so it never touches the bind session's `ofs` counter and can't
// interfere with the play/pause/seek commands. If you ever want the true current position on
// demand (e.g. app cold-start while something's already playing), add a `getNowPlaying` request
// threaded through the SAME client-held ofs/rid counter the commands use — do NOT add a
// continuous background poller that writes ofs independently, which would risk the "stale ofs ->
// silently dropped" failure mode that breaks casting commands.
export async function readNowPlayingStatus(
  loungeToken: string,
  session: Pick<BindSession, "sid" | "gsessionid">
): Promise<NowPlayingStatus> {
  const result = await fetchNowPlayingBatch(loungeToken, session);
  if (!result.ok) return { kind: "no_update" };
  try {
    return parseNowPlayingStatus(result.raw);
  } catch {
    return { kind: "no_update" };
  }
}
