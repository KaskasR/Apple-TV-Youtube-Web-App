import { Video } from "lucide-react";

// Shown on Home and Your Channels when not signed in. The button is a real link (full-page nav) —
// it starts the OAuth flow, which redirects out to Google and back.
export default function ConnectYouTube() {
  return (
    <div className="mt-12 flex flex-col items-center gap-5 text-center">
      <Video className="h-16 w-16 text-red-500" />
      <div>
        <p className="text-2xl font-bold text-white">Connect your YouTube</p>
        <p className="mx-auto mt-2 max-w-xs text-white/60">
          Sign in to see the latest videos from the channels you subscribe to.
        </p>
      </div>
      <a
        href="/api/auth/youtube/login"
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-red-500 px-8 text-lg font-bold text-white transition active:scale-[0.98]"
      >
        <Video className="h-6 w-6" />
        Connect YouTube
      </a>
      <p className="max-w-xs text-xs text-white/40">
        Shows uploads from your subscriptions — not YouTube’s personalized recommendations.
      </p>
    </div>
  );
}
