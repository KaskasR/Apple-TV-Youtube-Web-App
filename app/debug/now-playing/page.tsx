"use client";

// TEMPORARY DEBUG PAGE — for verifying lib/lounge/status.ts parsing against the real Apple TV.
// Not linked from anywhere in the app. Safe to delete once now-playing status is wired into the
// real UI and confirmed solid.

import { useEffect, useState } from "react";
import { loadSession } from "@/lib/storage";

const POLL_INTERVAL_MS = 3000;

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: unknown }
  | { status: "error"; message: string };

export default function NowPlayingDebugPage() {
  const [session, setSession] = useState<ReturnType<typeof loadSession>>(null);
  const [state, setState] = useState<FetchState>({ status: "idle" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(loadSession());
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    async function poll() {
      if (!session) return;
      setState((prev) => (prev.status === "loaded" ? prev : { status: "loading" }));
      try {
        const params = new URLSearchParams({
          token: session.token,
          sid: session.sid,
          gsessionid: session.gsessionid,
          raw: "1",
        });
        const res = await fetch(`/api/tv/nowplaying?${params.toString()}`);
        const data = await res.json();
        if (!cancelled) setState({ status: "loaded", data });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Fetch failed.",
          });
        }
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session, tick]);

  return (
    <div className="flex min-h-dvh flex-col gap-4 bg-black p-6 text-white">
      <h1 className="text-2xl font-bold">Now Playing — debug</h1>

      {!session && (
        <p className="text-red-400">
          No TV session in localStorage — pair with the TV on the main page first, then reload
          this page.
        </p>
      )}

      {session && (
        <>
          <button
            onClick={() => setTick((n) => n + 1)}
            className="min-h-[48px] w-fit rounded-lg border border-white/30 px-6 text-lg"
          >
            Refresh now
          </button>

          {state.status === "error" && <p className="text-red-400">{state.message}</p>}

          <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/15 p-4 text-sm">
            {state.status === "loaded" ? JSON.stringify(state.data, null, 2) : "Loading…"}
          </pre>
        </>
      )}
    </div>
  );
}
