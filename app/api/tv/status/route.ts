import { NextResponse } from "next/server";
import { getNowPlayingStatus } from "@/lib/lounge/client";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const sid = url.searchParams.get("sid");
  const gsessionid = url.searchParams.get("gsessionid");
  const rid = url.searchParams.get("rid");
  const nextOfs = url.searchParams.get("nextOfs");

  if (!token || !sid || !gsessionid || !rid || nextOfs === null) {
    return NextResponse.json({ status: null });
  }

  const status = await getNowPlayingStatus(token, {
    sid,
    gsessionid,
    rid: Number(rid),
    nextOfs: Number(nextOfs),
  });

  return NextResponse.json({ status });
}
