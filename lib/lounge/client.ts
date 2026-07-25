const LOUNGE_BASE = "https://www.youtube.com/api/lounge";

type PairResult = {
  screenId: string;
  loungeToken: string;
};

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

export async function pairWithScreen(pairingCode: string): Promise<PairResult> {
  const screenId = await getScreen(pairingCode);
  const loungeToken = await getLoungeToken(screenId);
  return { screenId, loungeToken };
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

async function openBindSession(
  loungeToken: string
): Promise<{ sid: string; gsessionid: string }> {
  const params = new URLSearchParams({
    RID: "1",
    VER: "8",
    CVER: "1",
    auth_failure_option: "send_error",
  });
  const body = new URLSearchParams({
    app: "youtube-desktop",
    "mdx-version": "3",
    name: "TV Guide",
    id: crypto.randomUUID(),
    device: "REMOTE_CONTROL",
    capabilities: "",
    theme: "cl",
    loungeIdToken: loungeToken,
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
  return { sid, gsessionid };
}

async function sendBoundCommand(
  sid: string,
  gsessionid: string,
  command: string,
  params: Record<string, string>
): Promise<void> {
  const query = new URLSearchParams({
    RID: "2",
    VER: "8",
    CVER: "1",
    gsessionid,
    SID: sid,
  });
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

// screenId isn't needed by the protocol itself (the bind session is scoped to the
// loungeToken), but callers pass it through — keeping the signature symmetric with
// pairWithScreen's result makes the API route contract obvious.
export async function playVideo(
  screenId: string,
  loungeToken: string,
  videoId: string
): Promise<void> {
  const { sid, gsessionid } = await openBindSession(loungeToken);
  await sendBoundCommand(sid, gsessionid, "setPlaylist", {
    videoId,
    videoIds: videoId,
    currentIndex: "0",
    currentTime: "0",
  });
}
