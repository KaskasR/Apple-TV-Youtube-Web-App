import { NextResponse } from "next/server";
import { playVideo } from "@/lib/lounge/client";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { screenId?: string; token?: string; videoId?: string }
    | null;
  const { screenId, token, videoId } = body ?? {};
  if (!screenId || !token || !videoId) {
    return NextResponse.json(
      { error: "Missing screenId, token, or videoId." },
      { status: 400 }
    );
  }

  try {
    await playVideo(screenId, token, videoId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Command failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
