import { NextRequest, NextResponse } from "next/server";
import { fetchNowPlayingBatch, parseNowPlayingStatus } from "@/lib/lounge/status";

const RAW_PREVIEW_LIMIT = 4000;

// Read-only status probe — new, isolated from app/api/tv/status/route.ts and
// app/api/tv/command/route.ts. Never sends a command, never mutates the bind session.
//
// Always returns a NowPlayingStatus in `status` (never null): "no_update" when the probe caught
// no playback event (the caller should keep its last known state — steady playback emits nothing),
// "stopped" on an explicit end, or "now_playing". A soft `note` carries the reason there was no
// update, purely for debugging; `raw` is included when ?raw=1 for the same reason.
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
    const result = await fetchNowPlayingBatch(token, { sid, gsessionid });
    if (!result.ok) {
      return NextResponse.json({ status: { kind: "no_update" }, note: result.reason });
    }

    const status = parseNowPlayingStatus(result.raw);
    return NextResponse.json({
      status,
      ...(includeRaw ? { raw: result.raw.slice(0, RAW_PREVIEW_LIMIT) } : {}),
    });
  } catch (err) {
    // Belt-and-suspenders — lib/lounge/status.ts already swallows its own errors, but this
    // route must never 500 the client just because a status probe had a bad moment.
    const message = err instanceof Error ? err.message : "Status probe failed.";
    return NextResponse.json({ status: { kind: "no_update" }, note: message });
  }
}
