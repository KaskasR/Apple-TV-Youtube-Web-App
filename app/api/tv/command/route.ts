import { NextResponse } from "next/server";
import {
  nextVideo,
  pauseVideo,
  playVideo,
  queueVideo,
  reconnectScreen,
  resumeVideo,
  seekTo,
  type BindSession,
} from "@/lib/lounge/client";

type Command = "play" | "queue" | "pause" | "resume" | "next" | "seek";

type CommandBody = {
  screenId?: string;
  token?: string;
  sid?: string;
  gsessionid?: string;
  rid?: number;
  nextOfs?: number;
  videoId?: string;
  seekSeconds?: number;
  command?: Command;
};

function runCommand(
  command: Command,
  token: string,
  session: BindSession,
  videoId?: string,
  seekSeconds?: number
): Promise<BindSession> {
  switch (command) {
    case "play":
      return playVideo(token, session, videoId!);
    case "queue":
      return queueVideo(token, session, videoId!);
    case "pause":
      return pauseVideo(token, session);
    case "resume":
      return resumeVideo(token, session);
    case "next":
      return nextVideo(token, session);
    case "seek":
      return seekTo(token, session, seekSeconds!);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CommandBody | null;
  const {
    screenId,
    token,
    sid,
    gsessionid,
    rid,
    nextOfs,
    videoId,
    seekSeconds,
    command = "play",
  } = body ?? {};

  if (!screenId || !token || !sid || !gsessionid || !rid || nextOfs === undefined) {
    return NextResponse.json(
      { error: "Missing screenId, token, sid, gsessionid, rid, or nextOfs." },
      { status: 400 }
    );
  }
  if ((command === "play" || command === "queue") && !videoId) {
    return NextResponse.json({ error: "Missing videoId." }, { status: 400 });
  }
  if (command === "seek" && seekSeconds === undefined) {
    return NextResponse.json({ error: "Missing seekSeconds." }, { status: 400 });
  }

  const session: BindSession = { sid, gsessionid, rid, nextOfs };

  try {
    const result = await runCommand(command, token, session, videoId, seekSeconds);
    return NextResponse.json({ ok: true, token, ...result });
  } catch {
    // The command already retried once with a fresh bind session on the same token — if it
    // still failed, the token itself is likely expired. Re-mint it from the stored screenId
    // (no TV code needed) and retry once more before giving up.
    try {
      const { loungeToken, session: freshSession } = await reconnectScreen(screenId);
      const result = await runCommand(command, loungeToken, freshSession, videoId, seekSeconds);
      return NextResponse.json({ ok: true, token: loungeToken, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command failed.";
      return NextResponse.json({ error: message, screenDead: true }, { status: 502 });
    }
  }
}
