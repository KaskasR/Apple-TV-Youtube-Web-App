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

// Auth mode: default (undefined) uses the app's API key and lets Next cache the response
// (public feed data). An OAuth access token switches to a Bearer request with `no-store` — user-
// private data (his subscriptions) must never land in Next's shared cache.
async function youtubeGet(
  path: string,
  params: Record<string, string>,
  accessToken?: string
): Promise<unknown> {
  const url = new URL(`${DATA_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let init: RequestInit;
  if (accessToken) {
    init = { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" };
  } else {
    url.searchParams.set("key", getApiKey());
    init = { next: { revalidate: REVALIDATE_SECONDS } };
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`YouTube Data API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchDurations(videoIds: string[]): Promise<Map<string, string | null>> {
  const durations = new Map<string, string | null>();
  // videos.list accepts at most 50 ids per call — batch so the subscriptions feed (many channels)
  // doesn't blow the limit.
  for (const batch of chunk(videoIds, 50)) {
    const data = (await youtubeGet("videos", {
      id: batch.join(","),
      part: "contentDetails",
    })) as { items?: { id?: string; contentDetails?: { duration?: string } }[] };
    for (const item of data.items ?? []) {
      if (!item.id) continue;
      durations.set(
        item.id,
        item.contentDetails?.duration ? parseIsoDuration(item.contentDetails.duration) : null
      );
    }
  }
  return durations;
}

// One subscribed channel's recent uploads (Your Channels page). Public data, keyed by channelId —
// no OAuth needed, so it's cacheable. Includes a live probe like the old handle-based feed.
export async function getChannelFeedById(channelId: string, max = 15): Promise<VideoSummary[]> {
  const uploadsMap = await fetchUploadsPlaylists([channelId]);
  const uploadsPlaylistId = uploadsMap.get(channelId);
  if (!uploadsPlaylistId) return [];

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
      channelTitle: videos[0]?.channelTitle ?? "",
      publishedAt: new Date().toISOString(),
      duration: null,
      isLive: true,
    });
  }

  return videos;
}

// ---- Subscriptions (Home + Your Channels) ----------------------------------------------------
// Everything below is driven by the signed-in user's real YouTube subscriptions (OAuth
// youtube.readonly). Home = a unified feed merged across ALL subscriptions; Your Channels = the
// list of subscribed channels (for the picker) + one channel's uploads via getChannelFeedById.

const SUBS_ITEMS_PER_CHANNEL = 5;
const SUBS_MAX_RESULTS = 40;
// Safety valve on subscription pagination (50/page) so a pathological account can't fan out forever.
const SUBS_MAX_PAGES = 5;

export type SubscribedChannel = { channelId: string; title: string; thumbnailUrl: string };

// All of the user's subscriptions, in YouTube's own returned order (roughly most-relevant first),
// paginated. OAuth (private) → no-store.
export async function getSubscribedChannels(accessToken: string): Promise<SubscribedChannel[]> {
  const channels: SubscribedChannel[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < SUBS_MAX_PAGES; page++) {
    const params: Record<string, string> = {
      part: "snippet",
      mine: "true",
      maxResults: "50",
      order: "relevance",
    };
    if (pageToken) params.pageToken = pageToken;

    const data = (await youtubeGet("subscriptions", params, accessToken)) as {
      nextPageToken?: string;
      items?: {
        snippet?: {
          title?: string;
          resourceId?: { channelId?: string };
          thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
        };
      }[];
    };

    for (const item of data.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      channels.push({
        channelId,
        title: item.snippet?.title ?? "Untitled channel",
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? "",
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return channels;
}

// Resolve many channelIds to their uploads playlist ids in one batched call (public data → API key).
async function fetchUploadsPlaylists(channelIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const batch of chunk(channelIds, 50)) {
    const data = (await youtubeGet("channels", {
      id: batch.join(","),
      part: "contentDetails",
      maxResults: "50",
    })) as {
      items?: { id?: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    };
    for (const item of data.items ?? []) {
      const uploads = item.contentDetails?.relatedPlaylists?.uploads;
      if (item.id && uploads) map.set(item.id, uploads);
    }
  }
  return map;
}

// Home feed: recent uploads merged across ALL of the user's subscriptions (per the user's choice —
// completeness over quota-capping; the client caches this per session so it's fetched rarely).
export async function getSubscriptionsFeed(accessToken: string): Promise<VideoSummary[]> {
  const channelIds = (await getSubscribedChannels(accessToken)).map((c) => c.channelId);
  if (channelIds.length === 0) return [];

  const uploads = await fetchUploadsPlaylists(channelIds);
  const playlistIds = channelIds.map((id) => uploads.get(id)).filter((v): v is string => Boolean(v));

  // A few recent uploads per channel, fetched in parallel. Use allSettled, not all: a subscribed
  // channel can have an empty/hidden/"Topic" uploads playlist that 404s, and one bad channel must
  // NOT sink the whole feed — just skip it.
  const settled = await Promise.allSettled(
    playlistIds.map((playlistId) => fetchPlaylistItems(playlistId, SUBS_ITEMS_PER_CHANNEL))
  );
  const perChannel = settled
    .filter((r): r is PromiseFulfilledResult<PlaylistItem[]> => r.status === "fulfilled")
    .map((r) => r.value);

  // Merge, newest-first, cap. (No live detection here — a per-channel live probe is 100 units each.)
  const merged = perChannel
    .flat()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, SUBS_MAX_RESULTS);

  const durations = await fetchDurations(merged.map((item) => item.videoId));

  return merged.map((item) => ({
    ...item,
    duration: durations.get(item.videoId) ?? null,
    isLive: false,
  }));
}
