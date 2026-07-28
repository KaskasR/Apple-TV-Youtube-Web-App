import { Tv } from "lucide-react";

type ConnectionStatusProps = {
  paired: boolean;
  // Compact: a small icon pill for page headers. Full: the labelled pill for the pairing screen.
  compact?: boolean;
};

export default function ConnectionStatus({ paired, compact }: ConnectionStatusProps) {
  if (compact) {
    return (
      <span
        aria-label={paired ? "Connected to Apple TV" : "Not connected"}
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          paired ? "bg-green-950 text-green-400" : "bg-white/10 text-white/50"
        }`}
      >
        <Tv className="h-5 w-5" />
      </span>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
        paired ? "bg-green-950 text-green-400" : "bg-white/10 text-white/60"
      }`}
    >
      <Tv className="h-4 w-4" />
      {paired ? "Connected to Apple TV" : "Not connected"}
    </div>
  );
}
