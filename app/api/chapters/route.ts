import { NextRequest, NextResponse } from "next/server";
import { parseChapters } from "@/lib/chapters";

const DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
const REVALIDATE_SECONDS = 600;

// Deliberately self-contained (doesn't import lib/youtube.ts) so this new, isolated feature
// can't touch the existing feed code's behavior — per CLAUDE.md's Debate Companion rule.
export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId." }, { status: 400 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is not set." }, { status: 500 });
  }

  const url = new URL(`${DATA_API_BASE}/videos`);
  url.searchParams.set("id", videoId);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) {
      throw new Error(`YouTube Data API videos.list failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { items?: { snippet?: { description?: string } }[] };
    const description = data.items?.[0]?.snippet?.description ?? "";
    return NextResponse.json({ chapters: parseChapters(description) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load chapters.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
