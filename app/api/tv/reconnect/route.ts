import { NextResponse } from "next/server";
import { reconnectScreen } from "@/lib/lounge/client";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { screenId?: string } | null;
  const screenId = body?.screenId;
  if (!screenId) {
    return NextResponse.json({ error: "Missing screenId." }, { status: 400 });
  }

  try {
    const { loungeToken, session } = await reconnectScreen(screenId);
    return NextResponse.json({ token: loungeToken, ...session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconnect failed.";
    return NextResponse.json({ error: message, screenDead: true }, { status: 502 });
  }
}
