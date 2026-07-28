import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/googleAuth";
import { getSubscribedChannels } from "@/lib/youtube";

// The signed-in user's subscribed channels (for the Your Channels picker). Doubles as the app's
// YouTube connection check: { connected: false } (401) when not signed in.
export async function GET(request: NextRequest) {
  const accessToken = await getAccessToken(request);
  if (!accessToken) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  try {
    const channels = await getSubscribedChannels(accessToken);
    return NextResponse.json({ connected: true, channels });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load your channels.";
    return NextResponse.json({ connected: true, error: message }, { status: 502 });
  }
}
