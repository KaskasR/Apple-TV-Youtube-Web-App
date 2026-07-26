import { NextResponse } from "next/server";
import { playVideo, queueVideo, reconnectScreen } from "@/lib/lounge/client";

const COMMANDS = { play: playVideo, queue: queueVideo } as const;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        screenId?: string;
        token?: string;
        sid?: string;
        gsessionid?: string;
        rid?: number;
        nextOfs?: number;
        videoId?: string;
        command?: "play" | "queue";
      }
    | null;
  const { screenId, token, sid, gsessionid, rid, nextOfs, videoId, command = "play" } = body ?? {};
  if (!screenId || !token || !sid || !gsessionid || !rid || nextOfs === undefined || !videoId) {
    return NextResponse.json(
      { error: "Missing screenId, token, sid, gsessionid, rid, nextOfs, or videoId." },
      { status: 400 }
    );
  }

  const runCommand = COMMANDS[command];
  if (!runCommand) {
    return NextResponse.json({ error: `Unknown command: ${command}` }, { status: 400 });
  }

  try {
    const session = await runCommand(token, { sid, gsessionid, rid, nextOfs }, videoId);
    return NextResponse.json({ ok: true, token, ...session });
  } catch {
    // The command already retried once with a fresh bind session on the same token — if it
    // still failed, the token itself is likely expired. Re-mint it from the stored screenId
    // (no TV code needed) and retry once more before giving up.
    try {
      const { loungeToken, session: freshSession } = await reconnectScreen(screenId);
      const session = await runCommand(loungeToken, freshSession, videoId);
      return NextResponse.json({ ok: true, token: loungeToken, ...session });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Command failed.";
      return NextResponse.json({ error: message, screenDead: true }, { status: 502 });
    }
  }
}
