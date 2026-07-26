const LOUNGE_BASE = "https://www.youtube.com/api/lounge";

async function getScreen(pairingCode: string): Promise<string> {
  const url = `${LOUNGE_BASE}/pairing/get_screen?pairing_code=${encodeURIComponent(pairingCode)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`get_screen failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { screen?: { screenId?: string } };
  const screenId = data.screen?.screenId;
  if (!screenId) {
    throw new Error("get_screen response did not include a screenId — check the TV code");
  }
  return screenId;
}

async function getLoungeToken(screenId: string): Promise<string> {
  const res = await fetch(`${LOUNGE_BASE}/pairing/get_lounge_token_batch`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ screen_ids: screenId }),
  });
  if (!res.ok) {
    throw new Error(`get_lounge_token_batch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    screens?: { screenId: string; loungeToken?: string }[];
  };
  const token = data.screens?.find((s) => s.screenId === screenId)?.loungeToken;
  if (!token) {
    throw new Error("get_lounge_token_batch response did not include a loungeToken");
  }
  return token;
}

type BindPayload = [string, ...unknown[]];

// The bind endpoint responds with a length-prefixed stream of JSON chunks
// (Google's undocumented "bind"/BrowserChannel wire format): each chunk is a
// decimal byte-length, a newline, then that many bytes of a `[index, payload][]` array.
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
      // Malformed/partial chunk — keep scanning, this isn't fatal for finding SID/gsessionid.
    }
  }
  return payloads;
}

// YouTube's bc/bind endpoint requires this full set of "connection" params as query
// params on every POST — including follow-up command requests, not just the initial
// handshake. Omitting loungeIdToken from a later request 401s with
// "Lounge ID Token should not be empty".
function commonBindParams(loungeToken: string): URLSearchParams {
  return new URLSearchParams({
    name: "TV Guide",
    app: "youtube-desktop",
    device: "REMOTE_CONTROL",
    VER: "8",
    CVER: "1",
    loungeIdToken: loungeToken,
  });
}

export type BindSession = {
  sid: string;
  gsessionid: string;
  rid: number;
  // Cumulative count of client->server messages already sent on this bind session (SID).
  // The bind/BrowserChannel wire protocol requires this as the `ofs` param on every command —
  // it is NOT always 0. Sending a stale `ofs` makes the server treat the request as a replay
  // of an already-seen message and silently drop it (200 OK, no error, no effect on the TV).
  nextOfs: number;
};

async function openBindSession(loungeToken: string): Promise<BindSession> {
  const params = commonBindParams(loungeToken);
  params.set("RID", "1");
  params.set("auth_failure_option", "send_error");

  const body = new URLSearchParams({
    "mdx-version": "3",
    id: crypto.randomUUID(),
    capabilities: "",
    theme: "cl",
  });

  const res = await fetch(`${LOUNGE_BASE}/bc/bind?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`bind handshake failed: ${res.status} ${res.statusText}`);
  }

  const payloads = parseBindChunks(await res.text());
  const sid = payloads.find((p) => p[0] === "c")?.[1] as string | undefined;
  const gsessionid = payloads.find((p) => p[0] === "S")?.[1] as string | undefined;
  if (!sid || !gsessionid) {
    throw new Error("bind handshake response did not include SID/gsessionid");
  }
  return { sid, gsessionid, rid: 2, nextOfs: 0 };
}

async function sendBoundCommand(
  loungeToken: string,
  session: BindSession,
  command: string,
  params: Record<string, string>
): Promise<void> {
  const query = commonBindParams(loungeToken);
  query.set("RID", String(session.rid));
  query.set("SID", session.sid);
  query.set("gsessionid", session.gsessionid);

  const body = new URLSearchParams({
    count: "1",
    ofs: String(session.nextOfs),
    req0__sc: command,
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`req0_${k}`, v])),
  });

  const res = await fetch(`${LOUNGE_BASE}/bc/bind?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`${command} command failed: ${res.status} ${res.statusText}`);
  }
}

export type PairResult = {
  screenId: string;
  loungeToken: string;
  session: BindSession;
};

export async function pairWithScreen(pairingCode: string): Promise<PairResult> {
  const screenId = await getScreen(pairingCode);
  const loungeToken = await getLoungeToken(screenId);
  const session = await openBindSession(loungeToken);
  return { screenId, loungeToken, session };
}

export type ReconnectResult = {
  loungeToken: string;
  session: BindSession;
};

// Re-mints a lounge_token and opens a fresh bind session from an already-paired screenId,
// without the "Link with TV code" step. Used to recover from an expired token without
// asking the user to re-pair (per CLAUDE.md's persistence rule).
export async function reconnectScreen(screenId: string): Promise<ReconnectResult> {
  const loungeToken = await getLoungeToken(screenId);
  const session = await openBindSession(loungeToken);
  return { loungeToken, session };
}

// Reuses the given bind session (no new handshake — that would re-trigger the TV's
// "new device connected" popup on every command). Only re-handshakes, once, if the
// stored session has gone stale.
export async function playVideo(
  loungeToken: string,
  session: BindSession,
  videoId: string
): Promise<BindSession> {
  const commandParams = {
    videoId,
    videoIds: videoId,
    currentIndex: "0",
    currentTime: "0",
  };

  try {
    await sendBoundCommand(loungeToken, session, "setPlaylist", commandParams);
    return { ...session, rid: session.rid + 1, nextOfs: session.nextOfs + 1 };
  } catch {
    const fresh = await openBindSession(loungeToken);
    await sendBoundCommand(loungeToken, fresh, "setPlaylist", commandParams);
    return { ...fresh, rid: fresh.rid + 1, nextOfs: fresh.nextOfs + 1 };
  }
}

// Queues a video without interrupting current playback ("Queue Next"). Unlike setPlaylist,
// this is unverified against the real TV — the Lounge API is undocumented and `addVideo` is
// reconstructed from community reverse-engineering, not an official spec. Test on the real TV;
// if it doesn't work, this is the only function that should need to change.
export async function queueVideo(
  loungeToken: string,
  session: BindSession,
  videoId: string
): Promise<BindSession> {
  const commandParams = { videoId };

  try {
    await sendBoundCommand(loungeToken, session, "addVideo", commandParams);
    return { ...session, rid: session.rid + 1, nextOfs: session.nextOfs + 1 };
  } catch {
    const fresh = await openBindSession(loungeToken);
    await sendBoundCommand(loungeToken, fresh, "addVideo", commandParams);
    return { ...fresh, rid: fresh.rid + 1, nextOfs: fresh.nextOfs + 1 };
  }
}

// Shared retry-once-with-fresh-session wrapper for the simple fire-and-forget remote-control
// commands below (pause/resume/next/seek) — same recovery behavior as playVideo/queueVideo above,
// factored out here since these four are new call sites, not a refactor of the existing ones.
async function runBoundCommand(
  loungeToken: string,
  session: BindSession,
  command: string,
  params: Record<string, string> = {}
): Promise<BindSession> {
  try {
    await sendBoundCommand(loungeToken, session, command, params);
    return { ...session, rid: session.rid + 1, nextOfs: session.nextOfs + 1 };
  } catch {
    const fresh = await openBindSession(loungeToken);
    await sendBoundCommand(loungeToken, fresh, command, params);
    return { ...fresh, rid: fresh.rid + 1, nextOfs: fresh.nextOfs + 1 };
  }
}

// Remote-bar commands (Phase 5) — like queueVideo, these are reconstructed from community
// reverse-engineering of the Lounge protocol, not official docs, so treat as unverified until
// confirmed on the real TV.
export async function pauseVideo(loungeToken: string, session: BindSession): Promise<BindSession> {
  return runBoundCommand(loungeToken, session, "pause");
}

export async function resumeVideo(loungeToken: string, session: BindSession): Promise<BindSession> {
  return runBoundCommand(loungeToken, session, "play");
}

export async function nextVideo(loungeToken: string, session: BindSession): Promise<BindSession> {
  return runBoundCommand(loungeToken, session, "next");
}

export async function seekTo(
  loungeToken: string,
  session: BindSession,
  timeSeconds: number
): Promise<BindSession> {
  return runBoundCommand(loungeToken, session, "seekTo", { newTime: String(timeSeconds) });
}

export type NowPlayingStatus = {
  videoId?: string;
  currentTime?: number;
  state?: "playing" | "paused" | "buffering" | "unknown";
};

const STATUS_POLL_TIMEOUT_MS = 3000;

// nowPlaying/onStateChange event payloads are reverse-engineered and have shown up as both
// URL-encoded "key=value&..." strings and JSON in different Lounge protocol versions — try both.
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

function extractNowPlaying(payloads: BindPayload[]): NowPlayingStatus | null {
  for (const [eventName, data] of payloads) {
    if (eventName !== "nowPlaying" && eventName !== "onStateChange") continue;
    if (typeof data !== "string") continue;

    const fields = parseEventFields(data);
    const currentTime = fields.currentTime ? Number(fields.currentTime) : undefined;
    const stateCode = fields.state;
    const state =
      stateCode === "1" ? "playing" : stateCode === "2" ? "paused" : stateCode === "3" ? "buffering" : "unknown";

    if (fields.videoId || currentTime !== undefined) {
      return { videoId: fields.videoId, currentTime, state };
    }
  }
  return null;
}

// Best-effort, short-timeout listen on the existing bind session's receive channel for a
// nowPlaying/onStateChange event. Per CLAUDE.md this must NOT be a persistent listener (would
// outlive a serverless function) — it opens the GET listen channel, reads whatever arrives within
// a few seconds, then gives up. Returns null on anything unexpected rather than throwing, since a
// flaky "now playing" status should never block the app.
export async function getNowPlayingStatus(
  loungeToken: string,
  session: BindSession
): Promise<NowPlayingStatus | null> {
  const query = commonBindParams(loungeToken);
  query.set("SID", session.sid);
  query.set("gsessionid", session.gsessionid);
  query.set("RID", "rpc");
  query.set("CI", "0");
  query.set("TYPE", "xmlhttp");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_POLL_TIMEOUT_MS);

  try {
    const res = await fetch(`${LOUNGE_BASE}/bc/bind?${query.toString()}`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let status: NowPlayingStatus | null = null;

    while (!status) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      status = extractNowPlaying(parseBindChunks(buffer));
    }
    await reader.cancel().catch(() => {});
    return status;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
