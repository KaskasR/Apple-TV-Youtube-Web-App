"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ListVideo } from "lucide-react";
import BottomNav, { NAV_HEIGHT_REM, type PageId } from "@/components/BottomNav";
import ChannelPicker from "@/components/ChannelPicker";
import ConnectionStatus from "@/components/ConnectionStatus";
import ConnectYouTube from "@/components/ConnectYouTube";
import NowPlayingBar, { type RemoteCommand, type TrackMeta } from "@/components/NowPlayingBar";
import PairingModal from "@/components/PairingModal";
import VideoCard from "@/components/VideoCard";
import { clearSession, loadSession, saveSession } from "@/lib/storage";

const PAGE_TITLES: Record<PageId, string> = {
  home: "Home",
  channels: "Your Channels",
  queued: "Queued",
};

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
  isLive: boolean;
};

type FeedState =
  | { status: "loading" }
  | { status: "loaded"; videos: Video[] }
  | { status: "error"; message: string };

type SubChannel = { channelId: string; title: string; thumbnailUrl: string };

// YouTube connection + the subscribed-channel list (drives the Your Channels picker, and gates Home
// and Your Channels behind the Connect screen).
type SubsState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "connected"; channels: SubChannel[] }
  | { status: "error"; message: string };

export default function Home() {
  const [code, setCode] = useState("");
  const [pairState, setPairState] = useState<PairState>({ status: "idle" });
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [queueingVideoId, setQueueingVideoId] = useState<string | null>(null);
  const [playError, setPlayError] = useState("");

  const [activePage, setActivePage] = useState<PageId>("home");

  // YouTube (OAuth) — connection + channel list, the Home feed, and the selected-channel feed.
  const [subsState, setSubsState] = useState<SubsState>({ status: "loading" });
  const [subsRequest, setSubsRequest] = useState(0);
  const [homeFeed, setHomeFeed] = useState<FeedState>({ status: "loading" });
  const [homeRequest, setHomeRequest] = useState(0);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelFeed, setChannelFeed] = useState<FeedState>({ status: "loading" });
  const [channelRequest, setChannelRequest] = useState(0);

  // In-memory queue mirror (session-only, auto-pruned on play).
  const [queued, setQueued] = useState<Video[]>([]);

  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  const [metaMap, setMetaMap] = useState<Map<string, TrackMeta>>(new Map());

  const isConnected = subsState.status === "connected";

  // Accumulate title/thumbnail metadata from any list of videos so the now-playing bar keeps
  // working across page switches, even for a video whose list isn't currently on screen.
  const mergeMeta = useCallback((videos: Video[]) => {
    setMetaMap((prev) => {
      const next = new Map(prev);
      for (const video of videos) {
        next.set(video.videoId, {
          title: video.title,
          channelTitle: video.channelTitle,
          thumbnailUrl: video.thumbnailUrl,
        });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    // localStorage isn't available during SSR — restore the paired session in the browser.
    const stored = loadSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setPairState({ status: "paired", ...stored });

    // Returning from the Google OAuth flow lands on /?connected=1 (or =error). Clean the URL so a
    // refresh doesn't re-trigger anything; surface an error if the connect failed.
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected === "error") {
      setPlayError(`Couldn't connect YouTube (${params.get("reason") ?? "unknown"}). Please try again.`);
    }
    if (connected) window.history.replaceState({}, "", "/");
  }, []);

  // Establish the YouTube connection + load the subscribed-channel list once paired. This is also
  // the app's connection check (401 → Connect screen).
  useEffect(() => {
    if (pairState.status !== "paired") return;
    let cancelled = false;

    async function loadSubs() {
      setSubsState({ status: "loading" });
      try {
        const res = await fetch("/api/subscriptions");
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401 || data.connected === false) {
          setSubsState({ status: "disconnected" });
          return;
        }
        if (!res.ok || data.error) throw new Error(data.error ?? "Failed to load your channels.");
        const channels = data.channels as SubChannel[];
        setSubsState({ status: "connected", channels });
        setSelectedChannelId((prev) => prev ?? channels[0]?.channelId ?? null);
      } catch (err) {
        if (!cancelled) {
          setSubsState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load your channels.",
          });
        }
      }
    }

    loadSubs();
    return () => {
      cancelled = true;
    };
  }, [pairState.status, subsRequest]);

  // Home feed — recent uploads across all subscriptions. Fetched once when connected (and on manual
  // refresh); the client keeps it in state so switching tabs doesn't refetch (quota-friendly).
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    async function loadHome() {
      setHomeFeed({ status: "loading" });
      try {
        const res = await fetch("/api/subscriptions/feed");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.error) throw new Error(data.error ?? "Failed to load your feed.");
        const videos = data.videos as Video[];
        setHomeFeed({ status: "loaded", videos });
        mergeMeta(videos);
      } catch (err) {
        if (!cancelled) {
          setHomeFeed({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load your feed.",
          });
        }
      }
    }

    loadHome();
    return () => {
      cancelled = true;
    };
  }, [isConnected, homeRequest, mergeMeta]);

  // Selected-channel feed (Your Channels). Public data by channelId — cheap and cached.
  useEffect(() => {
    if (!isConnected || !selectedChannelId) return;
    let cancelled = false;

    async function loadChannel() {
      setChannelFeed({ status: "loading" });
      try {
        const res = await fetch(`/api/feed?channelId=${encodeURIComponent(selectedChannelId!)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load channel.");
        const videos = data.videos as Video[];
        setChannelFeed({ status: "loaded", videos });
        mergeMeta(videos);
      } catch (err) {
        if (!cancelled) {
          setChannelFeed({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load channel.",
          });
        }
      }
    }

    loadChannel();
    return () => {
      cancelled = true;
    };
  }, [isConnected, selectedChannelId, channelRequest, mergeMeta]);

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
      const session = {
        screenId: data.screenId,
        token: data.token,
        sid: data.sid,
        gsessionid: data.gsessionid,
        rid: data.rid,
        nextOfs: data.nextOfs,
      };
      setPairState({ status: "paired", ...session });
      saveSession(session);
    } catch (err) {
      setPairState({
        status: "error",
        message: err instanceof Error ? err.message : "Pairing failed.",
      });
    }
  }

  async function sendTvCommand(
    command: "play" | "queue" | RemoteCommand,
    extra?: { videoId?: string; seekSeconds?: number }
  ) {
    if (pairState.status !== "paired") return;
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
        command,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.screenDead) {
        clearSession();
        setPairState({ status: "idle" });
        throw new Error("Lost connection to the TV — please link it again.");
      }
      throw new Error(data.error ?? "Command failed.");
    }
    const session = {
      screenId: pairState.screenId,
      token: data.token,
      sid: data.sid,
      gsessionid: data.gsessionid,
      rid: data.rid,
      nextOfs: data.nextOfs,
    };
    setPairState({ status: "paired", ...session });
    saveSession(session);
  }

  async function handleCommand(video: Video, command: "play" | "queue") {
    const setBusy = command === "play" ? setPlayingVideoId : setQueueingVideoId;
    setBusy(video.videoId);
    setPlayError("");
    try {
      await sendTvCommand(command, { videoId: video.videoId });
      if (command === "play") {
        // Play Now makes this the current video for the now-playing bar. Auto-prune from the queue.
        setCurrentVideoId(video.videoId);
        setQueued((prev) => prev.filter((v) => v.videoId !== video.videoId));
      } else {
        setQueued((prev) =>
          prev.some((v) => v.videoId === video.videoId) ? prev : [...prev, video]
        );
      }
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Command failed.");
    } finally {
      setBusy(null);
    }
  }

  function removeFromQueue(videoId: string) {
    setQueued((prev) => prev.filter((v) => v.videoId !== videoId));
  }

  async function disconnectYouTube() {
    try {
      await fetch("/api/auth/youtube/logout", { method: "POST" });
    } catch {
      // Even if the request fails, drop back to the Connect screen locally.
    }
    setSubsState({ status: "disconnected" });
    setSelectedChannelId(null);
    setHomeFeed({ status: "loading" });
    setChannelFeed({ status: "loading" });
  }

  // Render a feed's states (loading / error+retry / empty / list) — shared by Home and Your Channels.
  function renderFeed(feed: FeedState, onRetry: () => void, emptyText: string, withQueue: boolean) {
    if (feed.status === "loading") return <p className="text-white/70">Loading videos…</p>;
    if (feed.status === "error") {
      return (
        <div className="flex flex-col items-center gap-3">
          <p className="text-red-400">{feed.message}</p>
          <button
            onClick={onRetry}
            className="min-h-[48px] rounded-full border border-white/30 px-6 py-2 text-lg text-white"
          >
            Retry
          </button>
        </div>
      );
    }
    if (feed.videos.length === 0) return <p className="text-white/70">{emptyText}</p>;
    return (
      <ul className="flex flex-col gap-4">
        {feed.videos.map((video) => (
          <VideoCard
            key={video.videoId}
            video={video}
            onPlay={() => handleCommand(video, "play")}
            onQueue={withQueue ? () => handleCommand(video, "queue") : undefined}
            isPlaying={playingVideoId === video.videoId}
            isQueuing={queueingVideoId === video.videoId}
          />
        ))}
      </ul>
    );
  }

  // ---- Pairing screen ---------------------------------------------------------------------------
  if (pairState.status !== "paired") {
    return (
      <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-black px-6 text-center">
        <h1 className="text-4xl font-bold text-white">TV Guide</h1>
        <ConnectionStatus paired={false} />
        <PairingModal
          code={code}
          onCodeChange={setCode}
          onSubmit={handlePair}
          isPairing={pairState.status === "pairing"}
          errorMessage={pairState.status === "error" ? pairState.message : null}
        />
      </div>
    );
  }

  // Home & Your Channels both need YouTube; when not connected they show the Connect screen.
  const needsConnection = activePage === "home" || activePage === "channels";
  const showConnectGate = needsConnection && subsState.status !== "connected";

  // ---- Main app ---------------------------------------------------------------------------------
  return (
    <div className="flex min-h-dvh flex-col bg-black text-white">
      <main className="mx-auto w-full max-w-md flex-1 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+11rem)]">
        <header className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{PAGE_TITLES[activePage]}</h1>
          <div className="flex items-center gap-3">
            {isConnected && (
              <button
                onClick={disconnectYouTube}
                className="min-h-[44px] text-sm font-semibold text-white/50 underline"
              >
                Sign out
              </button>
            )}
            <ConnectionStatus paired compact />
          </div>
        </header>

        {playError && <p className="mb-4 text-red-400">{playError}</p>}

        {activePage === "queued" ? (
          queued.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-4 text-center">
              <ListVideo className="h-14 w-14 text-white/25" />
              <p className="text-xl font-semibold text-white/80">Nothing queued yet</p>
              <p className="max-w-xs text-sm text-white/50">
                Tap “Queue” on a video to line it up here. This list mirrors what you queue from this
                app during this session.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {queued.map((video) => (
                <VideoCard
                  key={video.videoId}
                  video={video}
                  onPlay={() => handleCommand(video, "play")}
                  isPlaying={playingVideoId === video.videoId}
                  onRemove={() => removeFromQueue(video.videoId)}
                />
              ))}
            </ul>
          )
        ) : showConnectGate ? (
          subsState.status === "loading" ? (
            <p className="text-white/70">Connecting…</p>
          ) : subsState.status === "error" ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-red-400">{subsState.message}</p>
              <button
                onClick={() => setSubsRequest((n) => n + 1)}
                className="min-h-[48px] rounded-full border border-white/30 px-6 py-2 text-lg text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <ConnectYouTube />
          )
        ) : activePage === "home" ? (
          renderFeed(
            homeFeed,
            () => setHomeRequest((n) => n + 1),
            "No recent videos from your subscriptions.",
            true
          )
        ) : (
          // Your Channels (connected)
          <>
            {subsState.status === "connected" && subsState.channels.length > 0 && selectedChannelId && (
              <div className="mb-5">
                <ChannelPicker
                  options={subsState.channels.map((c) => ({ id: c.channelId, label: c.title }))}
                  selectedId={selectedChannelId}
                  onSelect={setSelectedChannelId}
                />
              </div>
            )}
            {subsState.status === "connected" && subsState.channels.length === 0 ? (
              <p className="text-white/70">You don’t seem to be subscribed to any channels.</p>
            ) : (
              renderFeed(
                channelFeed,
                () => setChannelRequest((n) => n + 1),
                "No recent videos from this channel.",
                true
              )
            )}
          </>
        )}
      </main>

      <NowPlayingBar
        session={{
          token: pairState.token,
          sid: pairState.sid,
          gsessionid: pairState.gsessionid,
        }}
        currentVideoId={currentVideoId}
        videosById={metaMap}
        onCommand={(command, extra) => sendTvCommand(command, extra)}
        navHeightRem={NAV_HEIGHT_REM}
      />

      <BottomNav activePage={activePage} onSelect={setActivePage} queuedCount={queued.length} />
    </div>
  );
}
