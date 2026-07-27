import { ListPlus, Play } from "lucide-react";

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
  onQueue: () => void;
  isPlaying: boolean;
  isQueuing: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
};

export default function VideoCard({
  video,
  onPlay,
  onQueue,
  isPlaying,
  isQueuing,
  isSelected,
  onSelect,
}: VideoCardProps) {
  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border p-3 text-left ${
        isSelected ? "border-white/60" : "border-white/15"
      }`}
    >
      <button type="button" onClick={onSelect} aria-expanded={isSelected} className="flex w-full flex-col gap-3 text-left">
        {video.thumbnailUrl && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={video.thumbnailUrl} alt="" className="w-full rounded-md" />
            {video.isLive && (
              <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-1 text-xs font-bold text-white">
                LIVE
              </span>
            )}
          </div>
        )}
        <p className="text-lg font-semibold text-white">{video.title}</p>
        <p className="text-sm text-white/60">
          {video.channelTitle}
          {video.duration ? ` · ${video.duration}` : ""}
        </p>
      </button>
      <button
        onClick={onPlay}
        disabled={isPlaying}
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-xl font-semibold text-black disabled:opacity-50"
      >
        <Play className="h-6 w-6" fill="currentColor" />
        {isPlaying ? "Sending…" : "Play Now"}
      </button>
      <button
        onClick={onQueue}
        disabled={isQueuing}
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-lg border border-white/30 px-6 py-3 text-xl font-semibold text-white disabled:opacity-50"
      >
        <ListPlus className="h-6 w-6" />
        {isQueuing ? "Sending…" : "Queue Next"}
      </button>
    </li>
  );
}
