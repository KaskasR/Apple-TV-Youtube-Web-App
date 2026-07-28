import crypto from "node:crypto";
import type { NextRequest } from "next/server";

// Server-only Google OAuth helper for the Explore page's "his subscriptions" feed. Uses the
// youtube.readonly scope. Everything here runs on the server; the refresh token is only ever handed
// to the browser as an ENCRYPTED, httpOnly cookie — never in localStorage or a NEXT_PUBLIC value.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export const OAUTH_COOKIE = "yt_oauth"; // encrypted refresh token
export const STATE_COOKIE = "yt_oauth_state"; // CSRF state, short-lived

const isProd = process.env.NODE_ENV === "production";

export function sessionCookieOptions() {
  // secure only in production — dev runs on http://localhost, where Secure cookies wouldn't be set.
  return { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };
}

export function stateCookieOptions() {
  return { httpOnly: true, secure: isProd, sameSite: "lax" as const, path: "/", maxAge: 600 };
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set.");
  }
  return { clientId, clientSecret };
}

function getSecretKey(): Buffer {
  const secret = process.env.OAUTH_TOKEN_SECRET;
  if (!secret) throw new Error("OAUTH_TOKEN_SECRET is not set.");
  // Derive a fixed 32-byte key from whatever length the env secret is.
  return crypto.createHash("sha256").update(secret).digest();
}

// AES-256-GCM: iv(12) || tag(16) || ciphertext, base64url-encoded.
export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptToken(payload: string): string | null {
  try {
    const raw = Buffer.from(payload, "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered, wrong key, or garbage — treat as "not connected".
  }
}

// The exact redirect URI, derived from the incoming request so it matches whichever origin
// (localhost vs prod) is registered in the Google console. Must match a registered URI exactly.
export function callbackUrl(request: NextRequest): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}/api/auth/youtube/callback`;
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const { clientId } = getClientCredentials();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline"); // ask for a refresh token
  url.searchParams.set("prompt", "consent"); // force a refresh token even on re-auth
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

// Mint a fresh access token from the stored refresh token. Returns null if the grant was revoked or
// expired (the UI then falls back to the "reconnect" screen).
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as TokenResponse;
  return data.access_token ?? null;
}

export function getRefreshToken(request: NextRequest): string | null {
  const enc = request.cookies.get(OAUTH_COOKIE)?.value;
  if (!enc) return null;
  return decryptToken(enc);
}

export async function getAccessToken(request: NextRequest): Promise<string | null> {
  const refreshToken = getRefreshToken(request);
  if (!refreshToken) return null;
  return refreshAccessToken(refreshToken);
}
