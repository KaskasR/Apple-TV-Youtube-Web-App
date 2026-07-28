import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { STATE_COOKIE, buildAuthUrl, callbackUrl, stateCookieOptions } from "@/lib/googleAuth";

// Starts the OAuth flow: sets a CSRF `state` cookie and 302s to Google's consent screen.
export async function GET(request: NextRequest) {
  const state = crypto.randomBytes(16).toString("hex");
  try {
    const url = buildAuthUrl(state, callbackUrl(request));
    const res = NextResponse.redirect(url);
    res.cookies.set(STATE_COOKIE, state, stateCookieOptions());
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
