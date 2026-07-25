import { NextResponse } from "next/server";
import { pairWithScreen } from "@/lib/lounge/client";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing TV pairing code." }, { status: 400 });
  }

  try {
    const { screenId, loungeToken, session } = await pairWithScreen(code);
    return NextResponse.json({ screenId, token: loungeToken, ...session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pairing failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
