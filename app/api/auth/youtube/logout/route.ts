import { NextResponse } from "next/server";
import { OAUTH_COOKIE } from "@/lib/googleAuth";

// Disconnect: drop the refresh-token cookie. (We don't revoke server-side — clearing the cookie is
// enough for this app; the user can also remove access from their Google account settings.)
export async function POST() {
  const res = NextResponse.json({ connected: false });
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}
