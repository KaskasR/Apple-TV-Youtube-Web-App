"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FastForward, Pause, Play, Rewind, SkipForward } from "lucide-react";

export type RemoteCommand = "pause" | "resume" | "next" | "seek";

type RemoteSession = {
  token: string;
  sid: string;
  gsessionid: string;
  rid: number;
  nextOfs: number;
};

type NowPlayingStatus = {
  videoId?: string;
  currentTime?: number;
  state?: "playing" | "paused" | "buffering" | "unknown";
};

type RemoteBarProps = {
  session: RemoteSession;
  videoTitlesById: Map<string, string>;
  onCommand: (command: RemoteCommand, extra?: { seekSeconds?: number }) => Promise<void>;
};

const POLL_INTERVAL_MS = 5000;

// Local, optimistic tracking of playback position, updated by our own commands. The Lounge "now
// playing" status poll (below) is undocumented and has proven unreliable in practice — it rarely
// returns a fresh currentTime — so skip must not hard-depend on it, only use it as a bonus
// correction when it happens to work.
type TimeEstimate = {
  baseTime: number;
  // null until the first command anchors it — kept nullable so the initial ref value doesn't
  // need to call Date.now() during render (React forbids impure calls in the render body).
  baseTimeAnchorMs: number | null;
};

function estimateCurrentTime(estimate: TimeEstimate, playing: boolean): number {
  if (!playing || estimate.baseTimeAnchorMs === null) return estimate.baseTime;
  const elapsedSeconds = (Date.now() - estimate.baseTimeAnchorMs) / 1000;
  return estimate.baseTime + elapsedSeconds;
}

export default function RemoteBar({ session, videoTitlesById, onCommand }: RemoteBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<RemoteCommand | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  // Optimistic play/pause state, driven only by our own commands (not the flaky status poll) —
  // this is what fixes the toggle always sending "resume": it no longer depends on nowPlaying.
  const [isPlaying, setIsPlaying] = useState(true);
  const timeEstimateRef = useRef<TimeEstimate>({ baseTime: 0, baseTimeAnchorMs: null });

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;

    async function poll() {
      try {
        const params = new URLSearchParams({
          token: session.token,
          sid: session.sid,
          gsessionid: session.gsessionid,
          rid: String(session.rid),
          nextOfs: String(session.nextOfs),
        });
        const res = await fetch(`/api/tv/status?${params.toString()}`);
        const data = await res.json();
        const status = data.status as NowPlayingStatus | null;
        if (cancelled || !status) return;

        setTitle(status.videoId ? videoTitlesById.get(status.videoId) ?? null : null);

        // Bonus resync only — never required for pause/skip to work correctly.
        if (status.currentTime !== undefined) {
          timeEstimateRef.current = { baseTime: status.currentTime, baseTimeAnchorMs: Date.now() };
        }
        if (status.state === "playing" || status.state === "paused") {
          setIsPlaying(status.state === "playing");
        }
      } catch {
        // best-effort — ignore poll failures, keep last known estimate
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Deliberately keyed on sid/gsessionid/token, not rid/nextOfs — those bump on every command
    // (including ones sent from the video list), which would otherwise restart this poll loop
    // constantly. sid/gsessionid only change on a reconnect, which is when polling should restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, session.sid, session.gsessionid, session.token]);

  async function run(command: RemoteCommand, extra?: { seekSeconds?: number }) {
    setBusy(command);
    setError("");
    try {
      await onCommand(command, extra);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Command failed.");
      return;
    } finally {
      setBusy(null);
    }

    if (command === "pause") {
      timeEstimateRef.current = {
        baseTime: estimateCurrentTime(timeEstimateRef.current, isPlaying),
        baseTimeAnchorMs: Date.now(),
      };
      setIsPlaying(false);
    } else if (command === "resume") {
      timeEstimateRef.current = { ...timeEstimateRef.current, baseTimeAnchorMs: Date.now() };
      setIsPlaying(true);
    } else if (command === "seek" && extra?.seekSeconds !== undefined) {
      timeEstimateRef.current = { baseTime: extra.seekSeconds, baseTimeAnchorMs: Date.now() };
    }
  }

  async function handleSeek(deltaSeconds: number) {
    const target = Math.max(0, estimateCurrentTime(timeEstimateRef.current, isPlaying) + deltaSeconds);
    await run("seek", { seekSeconds: target });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center bg-black/95 text-white shadow-[0_-4px_16px_rgba(0,0,0,0.4)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 border-t border-white/10 py-2 text-sm font-semibold text-white/80"
      >
        {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
        Remote
      </button>

      {expanded && (
        <div className="flex w-full max-w-md flex-col items-center gap-3 px-4 pb-6">
          <p className="min-h-[1.5em] text-center text-white/70">{title ?? " "}</p>
          {error && <p className="text-red-400">{error}</p>}
          <div className="flex w-full items-center justify-center gap-3">
            <button
              onClick={() => handleSeek(-10)}
              disabled={busy !== null}
              aria-label="Skip back 10 seconds"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 disabled:opacity-50"
            >
              <Rewind className="h-6 w-6" />
            </button>
            <button
              onClick={() => run(isPlaying ? "pause" : "resume")}
              disabled={busy !== null}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
            >
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" />}
            </button>
            <button
              onClick={() => handleSeek(10)}
              disabled={busy !== null}
              aria-label="Skip forward 10 seconds"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 disabled:opacity-50"
            >
              <FastForward className="h-6 w-6" />
            </button>
            <button
              onClick={() => run("next")}
              disabled={busy !== null}
              aria-label="Next video"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 disabled:opacity-50"
            >
              <SkipForward className="h-6 w-6" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
