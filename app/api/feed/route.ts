import { NextRequest, NextResponse } from "next/server";
import { TABS, UNIFIED_TAB_ID, getAllChannels, getTabById } from "@/lib/channels";
import { getChannelFeed, type VideoSummary } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  const tabId = request.nextUrl.searchParams.get("tab") ?? TABS[0].id;
  const channels = tabId === UNIFIED_TAB_ID ? getAllChannels() : getTabById(tabId)?.channels;

  if (!channels) {
    return NextResponse.json({ error: `Unknown tab: ${tabId}` }, { status: 400 });
  }

  try {
    const results = await Promise.all(channels.map((channel) => getChannelFeed(channel.handle)));
    const videos: VideoSummary[] = results.flat().sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load feed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
