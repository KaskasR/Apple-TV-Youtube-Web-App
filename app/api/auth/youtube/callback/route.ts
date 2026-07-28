import { NextRequest, NextResponse } from "next/server";
import {
  OAUTH_COOKIE,
  STATE_COOKIE,
  callbackUrl,
  encryptToken,
  exchangeCode,
  sessionCookieOptions,
} from "@/lib/googleAuth";

// Google redirects here with `?code` and `?state`. Verify state, exchange the code, and store the
// encrypted refresh token in an httpOnly cookie. Then send the user back to the app (Explore).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const home = new URL("/?connected=1", request.nextUrl.origin);
  const fail = (reason: string) => {
    const url = new URL(`/?connected=error&reason=${encodeURIComponent(reason)}`, request.nextUrl.origin);
    return NextResponse.redirect(url);
  };

  if (params.get("error")) return fail(params.get("error") ?? "denied");

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("bad_state");
  }

  try {
    const tokens = await exchangeCode(code, callbackUrl(request));
    if (!tokens.refresh_token) {
      // No refresh token means we can't stay connected — usually a re-auth without prompt=consent.
      return fail("no_refresh_token");
    }
    const res = NextResponse.redirect(home);
    res.cookies.set(OAUTH_COOKIE, encryptToken(tokens.refresh_token), sessionCookieOptions());
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch {
    return fail("exchange_failed");
  }
}
