import { NextResponse } from "next/server";
import { playVideo } from "@/lib/lounge/client";

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
      }
    | null;
  const { screenId, token, sid, gsessionid, rid, nextOfs, videoId } = body ?? {};
  if (!screenId || !token || !sid || !gsessionid || !rid || nextOfs === undefined || !videoId) {
    return NextResponse.json(
      { error: "Missing screenId, token, sid, gsessionid, rid, nextOfs, or videoId." },
      { status: 400 }
    );
  }

  try {
    const session = await playVideo(token, { sid, gsessionid, rid, nextOfs }, videoId);
    return NextResponse.json({ ok: true, ...session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Command failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
