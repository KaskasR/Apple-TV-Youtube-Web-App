import { ListPlus, Play, Trash2 } from "lucide-react";

export type VideoCardVideo = {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  channelTitle: string;
  duration: string | null;
  isLive: boolean;
};

type VideoCardProps = {
  video: VideoCardVideo;
  onPlay: () => void;
  isPlaying: boolean;
  // Queue Next is shown only when onQueue is provided (feed pages, not the Queued page).
  onQueue?: () => void;
  isQueuing?: boolean;
  // Remove is shown only when onRemove is provided (the Queued page).
  onRemove?: () => void;
};

export default function VideoCard({
  video,
  onPlay,
  isPlaying,
  onQueue,
  isQueuing,
  onRemove,
}: VideoCardProps) {
  return (
    <li className="overflow-hidden rounded-2xl bg-neutral-900 shadow-lg shadow-black/40">
      {video.thumbnailUrl && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={video.thumbnailUrl} alt="" className="aspect-video w-full object-cover" />
          {video.isLive ? (
            <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
              <span className="h-2 w-2 rounded-full bg-white" />
              Live
            </span>
          ) : (
            video.duration && (
              <span className="absolute bottom-3 right-3 rounded-md bg-black/80 px-2 py-1 text-sm font-semibold text-white">
                {video.duration}
              </span>
            )
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 p-4 text-left">
        <div>
          <p className="text-lg font-semibold leading-snug text-white">{video.title}</p>
          <p className="mt-1 text-sm text-white/50">{video.channelTitle}</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onPlay}
            disabled={isPlaying}
            aria-label="Play Now"
            className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            <Play className="h-6 w-6" fill="currentColor" />
          </button>

          {onQueue && (
            <button
              onClick={onQueue}
              disabled={isQueuing}
              aria-label="Queue Next"
              className="flex min-h-[56px] flex-1 items-center justify-center gap-2 rounded-full border border-white/20 px-5 text-lg font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
            >
              <ListPlus className="h-5 w-5" />
              {isQueuing ? "Sending…" : "Queue Next"}
            </button>
          )}

          {onRemove && (
            <button
              onClick={onRemove}
              aria-label="Remove from queue"
              className="flex min-h-[56px] w-[56px] items-center justify-center rounded-full border border-white/20 text-white/70 transition active:scale-[0.98]"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
