import { Tv } from "lucide-react";

type ConnectionStatusProps = {
  paired: boolean;
};

export default function ConnectionStatus({ paired }: ConnectionStatusProps) {
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
