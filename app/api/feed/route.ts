import { NextResponse } from "next/server";
import { CHANNELS } from "@/lib/channels";
import { getRecentUploads } from "@/lib/youtube";

export async function GET() {
  try {
    const videos = await getRecentUploads(CHANNELS[0].handle);
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load feed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
