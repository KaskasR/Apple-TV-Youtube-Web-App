import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/googleAuth";
import { getSubscriptionsFeed } from "@/lib/youtube";

// The Home feed: recent uploads merged across ALL of the user's subscriptions.
// { connected: false } (401) when not signed in → UI shows the Connect screen.
export async function GET(request: NextRequest) {
  const accessToken = await getAccessToken(request);
  if (!accessToken) {
    return NextResponse.json({ connected: false }, { status: 401 });
  }

  try {
    const videos = await getSubscriptionsFeed(accessToken);
    return NextResponse.json({ connected: true, videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load your feed.";
    return NextResponse.json({ connected: true, error: message }, { status: 502 });
  }
}
