"use client";

import { useState, type FormEvent } from "react";

const TEST_VIDEO_ID = "dQw4w9WgXcQ";

type PairState =
  | { status: "idle" }
  | { status: "pairing" }
  | { status: "paired"; screenId: string; token: string }
  | { status: "error"; message: string };

type PlayState = "idle" | "playing" | "played" | "error";

export default function Home() {
  const [code, setCode] = useState("");
  const [pairState, setPairState] = useState<PairState>({ status: "idle" });
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [playError, setPlayError] = useState("");

  async function handlePair(e: FormEvent) {
    e.preventDefault();
    setPairState({ status: "pairing" });
    try {
      const res = await fetch("/api/tv/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Pairing failed.");
      setPairState({ status: "paired", screenId: data.screenId, token: data.token });
    } catch (err) {
      setPairState({
        status: "error",
        message: err instanceof Error ? err.message : "Pairing failed.",
      });
    }
  }

  async function handlePlay() {
    if (pairState.status !== "paired") return;
    setPlayState("playing");
    setPlayError("");
    try {
      const res = await fetch("/api/tv/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenId: pairState.screenId,
          token: pairState.token,
          videoId: TEST_VIDEO_ID,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Command failed.");
      setPlayState("played");
    } catch (err) {
      setPlayState("error");
      setPlayError(err instanceof Error ? err.message : "Command failed.");
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-black px-6 text-center">
      <h1 className="text-3xl font-bold text-white">TV Guide — cast test</h1>

      {pairState.status !== "paired" && (
        <form onSubmit={handlePair} className="flex w-full max-w-xs flex-col gap-3">
          <label htmlFor="code" className="text-lg text-white">
            Enter the TV code from YouTube → Settings → Link with TV code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-lg border border-white/30 bg-black px-4 py-3 text-xl text-white"
            placeholder="123456"
            inputMode="numeric"
          />
          <button
            type="submit"
            disabled={pairState.status === "pairing" || !code}
            className="min-h-[56px] rounded-lg bg-white px-6 py-3 text-xl font-semibold text-black disabled:opacity-50"
          >
            {pairState.status === "pairing" ? "Pairing…" : "Pair"}
          </button>
          {pairState.status === "error" && (
            <p className="text-red-400">{pairState.message}</p>
          )}
        </form>
      )}

      {pairState.status === "paired" && (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-green-400">Paired with TV.</p>
          <button
            onClick={handlePlay}
            disabled={playState === "playing"}
            className="min-h-[56px] rounded-lg bg-white px-6 py-3 text-xl font-semibold text-black disabled:opacity-50"
          >
            {playState === "playing" ? "Sending…" : "Play test video"}
          </button>
          {playState === "played" && (
            <p className="text-green-400">Sent — check the TV.</p>
          )}
          {playState === "error" && <p className="text-red-400">{playError}</p>}
        </div>
      )}
    </div>
  );
}
