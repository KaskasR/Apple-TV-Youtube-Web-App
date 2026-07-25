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
  return { sid, gsessionid, rid: 2 };
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
    ofs: "0",
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
    return { ...session, rid: session.rid + 1 };
  } catch {
    const fresh = await openBindSession(loungeToken);
    await sendBoundCommand(loungeToken, fresh, "setPlaylist", commandParams);
    return { ...fresh, rid: fresh.rid + 1 };
  }
}
