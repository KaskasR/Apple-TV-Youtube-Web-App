"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FastForward, Pause, Play, Rewind, SkipForward } from "lucide-react";
import { formatTimestamp } from "@/lib/chapters";
import DebateCompanion from "@/components/DebateCompanion";

// Reused command vocabulary — these map 1:1 to the existing command functions behind
// /api/tv/command (pause/resume/next/seek). This component adds NO new remote logic; every
// button calls onCommand, which the page routes to the existing sendTvCommand.
export type RemoteCommand = "pause" | "resume" | "next" | "seek";

export type TrackMeta = { title: string; channelTitle: string; thumbnailUrl: string };

type NowPlayingSession = { token: string; sid: string; gsessionid: string };

// Mirrors the Tier 1 status reader's shape at /api/tv/nowplaying — the source of truth. Field
// names taken from what that reader actually returns, not assumed.
type NowPlayingStatus =
  | { kind: "no_update" }
  | { kind: "stopped" }
  | {
      kind: "now_playing";
      videoId: string | null;
      title: string | null;
      isPlaying: boolean;
      positionSeconds: number | null;
      durationSeconds: number | null;
    };

type NowPlayingBarProps = {
  session: NowPlayingSession;
  // The videoId the app last told the TV to play — the reliable content key, since the status
  // reader's own videoId is usually null (it rides only the one-time nowPlaying event).
  currentVideoId: string | null;
  videosById: Map<string, TrackMeta>;
  onCommand: (command: RemoteCommand, extra?: { seekSeconds?: number }) => Promise<void>;
  // Height (in rem) of the bottom nav below us — the collapsed mini-bar sits directly above it
  // (Spotify-style). The expanded full-screen view still covers everything, nav included.
  navHeightRem?: number;
};

const POLL_INTERVAL_MS = 4000;
const SWIPE_DISMISS_PX = 120;
// How often the progress handle re-computes its extrapolated position while playing. The TV sends
// no periodic position updates (steady playback is silent), so this local tick is what makes the
// bar advance smoothly between transitions.
const TICK_INTERVAL_MS = 500;

// Local, optimistic playback-position estimate (same approach as the old RemoteBar): the TV only
// hands us a position anchor at transitions, so between them we extrapolate with wall-clock time.
// This is what lets Skip +10s compute an absolute seek target.
type TimeEstimate = { baseTime: number; baseTimeAnchorMs: number | null };

function estimateCurrentTime(estimate: TimeEstimate, playing: boolean): number {
  if (!playing || estimate.baseTimeAnchorMs === null) return estimate.baseTime;
  return estimate.baseTime + (Date.now() - estimate.baseTimeAnchorMs) / 1000;
}

function thumbnailFor(videoId: string | null, meta: TrackMeta | undefined): string {
  if (meta?.thumbnailUrl) return meta.thumbnailUrl;
  // Deterministic YouTube thumbnail — covers a video that isn't in the current feed (e.g. one
  // started from the TV itself) without any extra network call of our own.
  return videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "";
}

export default function NowPlayingBar({
  session,
  currentVideoId,
  videosById,
  onCommand,
  navHeightRem = 0,
}: NowPlayingBarProps) {
  const [visible, setVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [statusVideoId, setStatusVideoId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<RemoteCommand | null>(null);
  const [error, setError] = useState("");
  const [dragY, setDragY] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  // Extrapolated position, re-computed on a timer so the handle moves; frozen while the user is
  // actively dragging the scrubber (we show scrubValue instead then).
  const [displayedSeconds, setDisplayedSeconds] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const timeEstimateRef = useRef<TimeEstimate>({ baseTime: 0, baseTimeAnchorMs: null });

  // Optimistically show the bar the instant the app plays something — the status reader can take
  // a moment to catch the transition. Status then confirms/corrects play state below.
  useEffect(() => {
    if (!currentVideoId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
    setIsPlaying(true);
    timeEstimateRef.current = { baseTime: 0, baseTimeAnchorMs: Date.now() };
  }, [currentVideoId]);

  // Poll the Tier 1 status reader. Sequential (schedule next only after the previous finishes),
  // since each read can hold for a few seconds and overlapping polls would be wasteful.
  // Keyed on sid/gsessionid/token only — those change on a reconnect (when polling should
  // restart), not on every command.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const params = new URLSearchParams({
          token: session.token,
          sid: session.sid,
          gsessionid: session.gsessionid,
        });
        const res = await fetch(`/api/tv/nowplaying?${params.toString()}`);
        const data = await res.json();
        const status = data.status as NowPlayingStatus | undefined;
        if (cancelled || !status) return;

        if (status.kind === "stopped") {
          setVisible(false);
          setStatusVideoId(null);
        } else if (status.kind === "now_playing") {
          setVisible(true);
          setIsPlaying(status.isPlaying);
          if (status.videoId) setStatusVideoId(status.videoId);
          if (status.durationSeconds !== null) setDurationSeconds(status.durationSeconds);
          if (status.positionSeconds !== null) {
            timeEstimateRef.current = {
              baseTime: status.positionSeconds,
              baseTimeAnchorMs: Date.now(),
            };
          }
        }
        // kind === "no_update" (and any masked failure): retain last known state — do nothing.
      } catch {
        // Best-effort — a failed poll should never blank the bar; keep last known state.
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session.sid, session.gsessionid, session.token]);

  // Tick the displayed position while the bar is visible, from the local extrapolation. Skipped
  // while scrubbing so the user's drag isn't fought by the timer.
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      if (!scrubbing) setDisplayedSeconds(estimateCurrentTime(timeEstimateRef.current, isPlaying));
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [visible, isPlaying, scrubbing]);

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

  function handlePlayPause() {
    run(isPlaying ? "pause" : "resume");
  }

  function handleSkipBack() {
    const target = Math.max(0, estimateCurrentTime(timeEstimateRef.current, isPlaying) - 10);
    run("seek", { seekSeconds: target });
  }

  function handleSkipForward() {
    const target = Math.max(0, estimateCurrentTime(timeEstimateRef.current, isPlaying) + 10);
    run("seek", { seekSeconds: target });
  }

  function handleNext() {
    run("next");
  }

  function handleScrubChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScrubbing(true);
    setScrubValue(Number(e.currentTarget.value));
  }

  // Commit the scrub on release (pointer/touch up or keyboard) — send the existing seek command
  // with the dragged-to absolute position, then let the timer resume from there.
  function commitScrub() {
    if (!scrubbing) return;
    setScrubbing(false);
    setDisplayedSeconds(scrubValue);
    run("seek", { seekSeconds: Math.round(scrubValue) });
  }

  function onTouchStart(e: React.TouchEvent) {
    // Don't start a swipe-to-dismiss when the touch begins on the scrubber — that gesture is a
    // horizontal seek, not a downward dismiss.
    if ((e.target as HTMLElement).closest(".nowplaying-scrubber")) return;
    dragStartY.current = e.touches[0].clientY;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragStartY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStartY.current));
  }
  function onTouchEnd() {
    if (dragY > SWIPE_DISMISS_PX) setExpanded(false);
    setDragY(0);
    dragStartY.current = null;
  }

  const effectiveVideoId = statusVideoId ?? currentVideoId;
  const meta = effectiveVideoId ? videosById.get(effectiveVideoId) : undefined;
  const title = meta?.title ?? "Now playing";
  const channel = meta?.channelTitle ?? "";
  const thumbnail = thumbnailFor(effectiveVideoId, meta);

  // Progress derivation. We only have a meaningful scrubber once the TV has reported a duration.
  const hasDuration = durationSeconds !== null && durationSeconds > 0;
  const positionSeconds = scrubbing ? scrubValue : Math.min(displayedSeconds, durationSeconds ?? displayedSeconds);
  const progressPct = hasDuration ? Math.min(100, Math.max(0, (positionSeconds / durationSeconds!) * 100)) : 0;

  // Nothing to show → render nothing at all, so the feed is never covered.
  if (!visible || !effectiveVideoId) return null;

  return (
    <>
      {/* Collapsed mini-bar — sits directly above the bottom nav (navHeightRem) plus the safe-area. */}
      {!expanded && (
        <div
          className="fixed inset-x-0 z-30 px-3"
          style={{ bottom: `calc(env(safe-area-inset-bottom) + ${navHeightRem}rem + 0.5rem)` }}
        >
          <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
            <div className="flex items-center gap-3 p-3">
              <button
                onClick={() => setExpanded(true)}
                aria-label="Open now playing"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbnail} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-white">{title}</p>
                  {channel && <p className="truncate text-sm text-white/60">{channel}</p>}
                </div>
              </button>
              <button
                onClick={handlePlayPause}
                disabled={busy !== null}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
              >
                {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="h-7 w-7" fill="currentColor" />}
              </button>
            </div>
            {/* Thin, non-interactive progress line (Spotify-style) */}
            {hasDuration && (
              <div className="h-1 w-full bg-white/15">
                <div className="h-full bg-white" style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded full-screen now-playing view (slides up; swipe-down or chevron to dismiss) */}
      <div
        className="fixed inset-0 z-40 flex flex-col bg-neutral-950 transition-transform duration-300"
        style={{
          transform: expanded ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: dragY > 0 ? "none" : undefined,
          pointerEvents: expanded ? "auto" : "none",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <button
            onClick={() => setExpanded(false)}
            aria-label="Close now playing"
            className="flex h-14 w-14 items-center justify-center rounded-full text-white/80"
          >
            <ChevronDown className="h-8 w-8" />
          </button>
          <span className="text-sm font-semibold uppercase tracking-wide text-white/50">Now Playing</span>
          <span className="h-14 w-14" aria-hidden />
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-8 py-6">
          {thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="aspect-video w-full rounded-2xl object-cover shadow-2xl" />
          )}
          <div className="w-full text-center">
            <p className="text-2xl font-bold text-white">{title}</p>
            {channel && <p className="mt-2 text-lg text-white/60">{channel}</p>}
          </div>

          {/* Scrubber — drag to seek. Reuses the existing seek command; only shown once the TV has
              reported a duration. */}
          {hasDuration && (
            <div className="w-full">
              <input
                type="range"
                className="nowplaying-scrubber w-full"
                min={0}
                max={durationSeconds!}
                step={1}
                value={positionSeconds}
                onChange={handleScrubChange}
                onPointerUp={commitScrub}
                onTouchEnd={commitScrub}
                onKeyUp={commitScrub}
                aria-label="Seek"
                style={{ ["--progress" as string]: `${progressPct}%` }}
              />
              <div className="mt-1 flex justify-between text-sm text-white/60">
                <span>{formatTimestamp(positionSeconds)}</span>
                <span>{formatTimestamp(durationSeconds!)}</span>
              </div>
            </div>
          )}

          {error && <p className="text-red-400">{error}</p>}

          <div className="flex w-full items-center justify-between">
            <button
              onClick={handleSkipBack}
              disabled={busy !== null}
              aria-label="Skip back 10 seconds"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-50"
            >
              <Rewind className="h-7 w-7" />
            </button>
            <button
              onClick={handlePlayPause}
              disabled={busy !== null}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
            >
              {isPlaying ? <Pause className="h-10 w-10" /> : <Play className="h-10 w-10" fill="currentColor" />}
            </button>
            <button
              onClick={handleSkipForward}
              disabled={busy !== null}
              aria-label="Skip forward 10 seconds"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-50"
            >
              <FastForward className="h-7 w-7" />
            </button>
            <button
              onClick={handleNext}
              disabled={busy !== null}
              aria-label="Skip to next video"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white disabled:opacity-50"
            >
              <SkipForward className="h-7 w-7" />
            </button>
          </div>

          {/* Chapters (moved here from the feed) — jump the TV to a timestamp via the existing
              seek command. Renders nothing when the video has no chapters. Mounted only while
              expanded so we don't fetch chapters for a video the user never opens. */}
          {expanded && (
            <div className="w-full">
              <DebateCompanion
                videoId={effectiveVideoId}
                onSeek={(seconds) => run("seek", { seekSeconds: Math.round(seconds) })}
              />
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  );
}
