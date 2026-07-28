import { Home, ListVideo, Tv } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PageId = "home" | "channels" | "queued";

// Nav content height in rem — exported so NowPlayingBar can sit its mini-bar directly above the
// nav (Spotify-style). Keep this in sync with the h-[...] on the nav row below.
export const NAV_HEIGHT_REM = 4.25;

type NavItem = { id: PageId; label: string; icon: LucideIcon };

const ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "channels", label: "Your Channels", icon: Tv },
  { id: "queued", label: "Queued", icon: ListVideo },
];

type BottomNavProps = {
  activePage: PageId;
  onSelect: (page: PageId) => void;
  queuedCount: number;
};

export default function BottomNav({ activePage, onSelect, queuedCount }: BottomNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div
        className="mx-auto flex max-w-md items-stretch"
        style={{ height: `${NAV_HEIGHT_REM}rem` }}
      >
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = id === activePage;
          const showBadge = id === "queued" && queuedCount > 0;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? "text-red-500" : "text-white/50"
              }`}
            >
              <span className="relative">
                <Icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
                {showBadge && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                    {queuedCount}
                  </span>
                )}
              </span>
              <span className={`text-xs ${isActive ? "font-bold" : "font-medium"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
