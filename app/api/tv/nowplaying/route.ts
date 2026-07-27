import { NextRequest, NextResponse } from "next/server";
import { fetchNowPlayingBatch, parseNowPlayingStatus } from "@/lib/lounge/status";

const RAW_PREVIEW_LIMIT = 4000;

// Read-only status probe — new, isolated from app/api/tv/status/route.ts and
// app/api/tv/command/route.ts. Never sends a command, never mutates the bind session.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const sid = request.nextUrl.searchParams.get("sid");
  const gsessionid = request.nextUrl.searchParams.get("gsessionid");
  const includeRaw = request.nextUrl.searchParams.get("raw") === "1";

  if (!token || !sid || !gsessionid) {
    return NextResponse.json(
      { error: "Missing token, sid, or gsessionid." },
      { status: 400 }
    );
  }

  try {
    const raw = await fetchNowPlayingBatch(token, { sid, gsessionid });
    if (raw === null) {
      return NextResponse.json({ status: null, error: "Could not reach the TV." });
    }

    const status = parseNowPlayingStatus(raw);
    return NextResponse.json({
      status,
      ...(includeRaw ? { raw: raw.slice(0, RAW_PREVIEW_LIMIT) } : {}),
    });
  } catch (err) {
    // Belt-and-suspenders — lib/lounge/status.ts already swallows its own errors, but this
    // route must never 500 the client just because a status probe had a bad moment.
    const message = err instanceof Error ? err.message : "Status probe failed.";
    return NextResponse.json({ status: null, error: message });
  }
}
