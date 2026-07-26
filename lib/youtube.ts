const DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
const REVALIDATE_SECONDS = 600;

export type VideoSummary = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
  duration: string | null;
  isLive: boolean;
};

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is not set.");
  }
  return key;
}

async function youtubeGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${DATA_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("key", getApiKey());

  const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
  if (!res.ok) {
    throw new Error(`YouTube Data API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function resolveChannel(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string }> {
  const data = (await youtubeGet("channels", {
    forHandle: handle,
    part: "id,contentDetails",
  })) as {
    items?: { id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  };
  const channelId = data.items?.[0]?.id;
  const uploadsPlaylistId = data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!channelId || !uploadsPlaylistId) {
    throw new Error(`Could not resolve channel ${handle}`);
  }
  return { channelId, uploadsPlaylistId };
}

type LiveVideo = { videoId: string; title: string; thumbnailUrl: string };

async function checkLive(channelId: string): Promise<LiveVideo | null> {
  const data = (await youtubeGet("search", {
    channelId,
    eventType: "live",
    type: "video",
    part: "snippet",
    maxResults: "1",
  })) as {
    items?: {
      id?: { videoId?: string };
      snippet?: { title?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
    }[];
  };

  const item = data.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return null;
  return {
    videoId,
    title: item?.snippet?.title ?? "Live now",
    thumbnailUrl: item?.snippet?.thumbnails?.medium?.url ?? item?.snippet?.thumbnails?.default?.url ?? "",
  };
}

type PlaylistItem = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  publishedAt: string;
};

async function fetchPlaylistItems(playlistId: string, max: number): Promise<PlaylistItem[]> {
  const data = (await youtubeGet("playlistItems", {
    playlistId,
    part: "snippet,contentDetails",
    maxResults: String(max),
  })) as {
    items?: {
      contentDetails?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }[];
  };

  const items: PlaylistItem[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.contentDetails?.videoId;
    if (!videoId) continue;
    items.push({
      videoId,
      title: item.snippet?.title ?? "Untitled",
      thumbnailUrl:
        item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
      channelTitle: item.snippet?.channelTitle ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
    });
  }
  return items;
}

function parseIsoDuration(iso: string): string | null {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);

  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

async function fetchDurations(videoIds: string[]): Promise<Map<string, string | null>> {
  if (videoIds.length === 0) return new Map();
  const data = (await youtubeGet("videos", {
    id: videoIds.join(","),
    part: "contentDetails",
  })) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };

  const durations = new Map<string, string | null>();
  for (const item of data.items ?? []) {
    if (!item.id) continue;
    durations.set(item.id, item.contentDetails?.duration ? parseIsoDuration(item.contentDetails.duration) : null);
  }
  return durations;
}

export async function getChannelFeed(handle: string, max = 15): Promise<VideoSummary[]> {
  const { channelId, uploadsPlaylistId } = await resolveChannel(handle);
  const [items, live] = await Promise.all([
    fetchPlaylistItems(uploadsPlaylistId, max),
    checkLive(channelId),
  ]);
  const durations = await fetchDurations(items.map((item) => item.videoId));

  const videos: VideoSummary[] = items.map((item) => ({
    ...item,
    duration: durations.get(item.videoId) ?? null,
    isLive: item.videoId === live?.videoId,
  }));

  if (live && !videos.some((video) => video.videoId === live.videoId)) {
    videos.unshift({
      videoId: live.videoId,
      title: live.title,
      thumbnailUrl: live.thumbnailUrl,
      channelTitle: videos[0]?.channelTitle ?? handle,
      publishedAt: new Date().toISOString(),
      duration: null,
      isLive: true,
    });
  }

  return videos;
}
