import type { BindSession } from "@/lib/lounge/client";

// Deliberately self-contained — does not import bind/parsing internals from lib/lounge/client.ts
// (they're private to that file, and per the now-playing task this is meant to be a fresh,
// isolated read path, not a reuse of the flaky Phase 5 attempt). Only the BindSession *type* is
// shared, since a status read rides the same already-open bind session as commands do.
const LOUNGE_BASE = "https://www.youtube.com/api/lounge";
const STATUS_POLL_TIMEOUT_MS = 3000;

export type NowPlayingStatus =
  | { kind: "nothing_playing" }
  | {
      kind: "now_playing";
      videoId: string;
      title: string | null;
      isPlaying: boolean;
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

// nowPlaying/onStateChange event payloads have shown up as both URL-encoded "key=value&..."
// strings and JSON in different Lounge protocol versions — try both, same as client.ts.
function parseEventFields(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {
    // not JSON — fall through to query-string parsing
  }
  const fields: Record<string, string> = {};
  for (const pair of raw.split("&")) {
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

// Pure parser: given the raw decoded batch text from the bind channel's listen response, finds
// the most recent nowPlaying/onStateChange event and returns a clear "now_playing" or
// "nothing_playing" result. Never throws — worst case it falls back to "nothing_playing".
export function parseNowPlayingStatus(raw: string): NowPlayingStatus {
  const payloads = parseBindChunks(raw);

  for (const [eventName, data] of payloads) {
    if (eventName !== "nowPlaying" && eventName !== "onStateChange") continue;
    if (typeof data !== "string") continue;

    const fields = parseEventFields(data);
    const videoId = fields.videoId || fields.video_id;
    const stateCode = fields.state;

    // Lounge state codes (reverse-engineered): -1 unstarted, 0 ended, 1 playing, 2 paused,
    // 3 buffering, 5 cued. Treat -1/0/missing as "nothing meaningfully playing".
    if (!videoId || stateCode === "-1" || stateCode === "0" || stateCode === undefined) {
      continue;
    }

    return {
      kind: "now_playing",
      videoId,
      title: fields.title || fields.videoTitle || null,
      isPlaying: stateCode === "1",
      positionSeconds: toNumber(fields.currentTime),
      durationSeconds: toNumber(fields.duration),
    };
  }

  return { kind: "nothing_playing" };
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

// Opens the bind channel's GET listen endpoint on an already-open session, reads whatever
// arrives within a short timeout, then gives up — per CLAUDE.md this must never be a persistent
// listener (would outlive a serverless function). Returns the raw decoded text, or null on any
// connection failure/timeout. Never throws.
export async function fetchNowPlayingBatch(
  loungeToken: string,
  session: Pick<BindSession, "sid" | "gsessionid">
): Promise<string | null> {
  const query = statusQueryParams(loungeToken, session);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_POLL_TIMEOUT_MS);
  let buffer = "";

  try {
    const res = await fetch(`${LOUNGE_BASE}/bc/bind?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return null;

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
    return buffer;
  } catch {
    // Aborted by the timeout (or a network error) — return whatever was buffered before that.
    // A partial batch is still useful to parse; per CLAUDE.md we must give up by
    // STATUS_POLL_TIMEOUT_MS no matter what, never hold the connection open longer.
    return buffer.length > 0 ? buffer : null;
  } finally {
    clearTimeout(timeout);
  }
}

// Composes fetchNowPlayingBatch + parseNowPlayingStatus. Returns null only on a connection
// failure/timeout (the TV/session is unreachable) — a legitimately idle TV returns
// { kind: "nothing_playing" }, never null, so callers can tell the two apart.
export async function readNowPlayingStatus(
  loungeToken: string,
  session: Pick<BindSession, "sid" | "gsessionid">
): Promise<NowPlayingStatus | null> {
  const raw = await fetchNowPlayingBatch(loungeToken, session);
  if (raw === null) return null;
  try {
    return parseNowPlayingStatus(raw);
  } catch {
    return null;
  }
}
