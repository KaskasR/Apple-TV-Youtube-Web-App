"use client";

import { useEffect, useState } from "react";
import { formatTimestamp, type Chapter } from "@/lib/chapters";

type DebateCompanionProps = {
  videoId: string;
  onSeek: (seconds: number) => Promise<void>;
};

type ChaptersState =
  | { status: "loading" }
  | { status: "loaded"; chapters: Chapter[] }
  | { status: "error"; message: string };

export default function DebateCompanion({ videoId, onSeek }: DebateCompanionProps) {
  const [state, setState] = useState<ChaptersState>({ status: "loading" });
  const [seekingSeconds, setSeekingSeconds] = useState<number | null>(null);
  const [seekError, setSeekError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      setSeekError("");
      try {
        const res = await fetch(`/api/chapters?videoId=${encodeURIComponent(videoId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load chapters.");
        if (!cancelled) setState({ status: "loaded", chapters: data.chapters });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load chapters.",
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  async function handleTap(chapter: Chapter) {
    setSeekingSeconds(chapter.seconds);
    setSeekError("");
    try {
      await onSeek(chapter.seconds);
    } catch (err) {
      setSeekError(err instanceof Error ? err.message : "Couldn't jump to that chapter.");
    } finally {
      setSeekingSeconds(null);
    }
  }

  if (state.status === "loading") {
    return <p className="text-white/60">Loading chapters…</p>;
  }

  if (state.status === "error") {
    return <p className="text-red-400">{state.message}</p>;
  }

  if (state.chapters.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-semibold text-white">Chapters</p>
      {seekError && <p className="text-red-400">{seekError}</p>}
      <ul className="flex flex-col gap-3">
        {state.chapters.map((chapter) => (
          <li key={chapter.seconds}>
            <button
              onClick={() => handleTap(chapter)}
              disabled={seekingSeconds !== null}
              className="flex min-h-[56px] w-full items-center rounded-lg border border-white/30 px-6 py-3 text-left text-xl font-semibold text-white disabled:opacity-50"
            >
              {formatTimestamp(chapter.seconds)} — {chapter.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
