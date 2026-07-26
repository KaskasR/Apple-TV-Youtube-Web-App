"use client";

import { useEffect, useState, type FormEvent } from "react";

type Session = {
  screenId: string;
  token: string;
  sid: string;
  gsessionid: string;
  rid: number;
  nextOfs: number;
};

type PairState =
  | { status: "idle" }
  | { status: "pairing" }
  | ({ status: "paired" } & Session)
  | { status: "error"; message: string };

type Video = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  duration: string | null;
};

type FeedState =
  | { status: "loading" }
  | { status: "loaded"; videos: Video[] }
  | { status: "error"; message: string };

export default function Home() {
  const [code, setCode] = useState("");
  const [pairState, setPairState] = useState<PairState>({ status: "idle" });
  const [feedState, setFeedState] = useState<FeedState>({ status: "loading" });
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [playError, setPlayError] = useState("");
  const [feedRequest, setFeedRequest] = useState(0);

  useEffect(() => {
    if (pairState.status !== "paired") return;
    let cancelled = false;

    async function loadFeed() {
      setFeedState({ status: "loading" });
      try {
        const res = await fetch("/api/feed");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load feed.");
        if (!cancelled) setFeedState({ status: "loaded", videos: data.videos });
      } catch (err) {
        if (!cancelled) {
          setFeedState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load feed.",
          });
        }
      }
    }

    loadFeed();
    return () => {
      cancelled = true;
    };
  }, [pairState.status, feedRequest]);

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
      setPairState({
        status: "paired",
        screenId: data.screenId,
        token: data.token,
        sid: data.sid,
        gsessionid: data.gsessionid,
        rid: data.rid,
        nextOfs: data.nextOfs,
      });
    } catch (err) {
      setPairState({
        status: "error",
        message: err instanceof Error ? err.message : "Pairing failed.",
      });
    }
  }

  async function handlePlay(videoId: string) {
    if (pairState.status !== "paired") return;
    setPlayingVideoId(videoId);
    setPlayError("");
    try {
      const res = await fetch("/api/tv/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenId: pairState.screenId,
          token: pairState.token,
          sid: pairState.sid,
          gsessionid: pairState.gsessionid,
          rid: pairState.rid,
          nextOfs: pairState.nextOfs,
          videoId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Command failed.");
      setPairState((prev) =>
        prev.status === "paired"
          ? { ...prev, sid: data.sid, gsessionid: data.gsessionid, rid: data.rid, nextOfs: data.nextOfs }
          : prev
      );
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Command failed.");
    } finally {
      setPlayingVideoId(null);
    }
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center gap-6 bg-black px-6 py-10 text-center">
      <h1 className="text-3xl font-bold text-white">TV Guide</h1>

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
        <div className="flex w-full max-w-md flex-col gap-4">
          <p className="text-green-400">Paired with TV.</p>
          {playError && <p className="text-red-400">{playError}</p>}

          {feedState.status === "loading" && <p className="text-white/70">Loading videos…</p>}

          {feedState.status === "error" && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-red-400">{feedState.message}</p>
              <button
                onClick={() => setFeedRequest((n) => n + 1)}
                className="min-h-[48px] rounded-lg border border-white/30 px-6 py-2 text-lg text-white"
              >
                Retry
              </button>
            </div>
          )}

          {feedState.status === "loaded" && feedState.videos.length === 0 && (
            <p className="text-white/70">No videos found.</p>
          )}

          {feedState.status === "loaded" && feedState.videos.length > 0 && (
            <ul className="flex flex-col gap-4">
              {feedState.videos.map((video) => (
                <li
                  key={video.videoId}
                  className="flex flex-col gap-2 rounded-lg border border-white/15 p-3 text-left"
                >
                  {video.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      className="w-full rounded-md"
                    />
                  )}
                  <p className="text-lg font-semibold text-white">{video.title}</p>
                  <p className="text-sm text-white/60">
                    {video.channelTitle}
                    {video.duration ? ` · ${video.duration}` : ""}
                  </p>
                  <button
                    onClick={() => handlePlay(video.videoId)}
                    disabled={playingVideoId === video.videoId}
                    className="min-h-[56px] rounded-lg bg-white px-6 py-3 text-xl font-semibold text-black disabled:opacity-50"
                  >
                    {playingVideoId === video.videoId ? "Sending…" : "Play Now"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
