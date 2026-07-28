import { NextRequest, NextResponse } from "next/server";
import { getChannelFeedById } from "@/lib/youtube";

// One channel's recent uploads + live, by channelId (Your Channels page). Public data via the API
// key — the channelId comes from the user's subscriptions list (/api/subscriptions).
export async function GET(request: NextRequest) {
  const channelId = request.nextUrl.searchParams.get("channelId");
  if (!channelId) {
    return NextResponse.json({ error: "Missing channelId." }, { status: 400 });
  }

  try {
    const videos = await getChannelFeedById(channelId);
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load channel.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
