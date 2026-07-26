export type TabOption = {
  id: string;
  label: string;
  emoji: string;
};

type ChannelTabsProps = {
  tabs: TabOption[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
};

export default function ChannelTabs({ tabs, activeTabId, onSelect }: ChannelTabsProps) {
  return (
    <div className="flex w-full flex-wrap justify-center gap-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`min-h-[48px] rounded-lg px-4 py-2 text-lg font-semibold ${
              isActive ? "bg-white text-black" : "border border-white/30 text-white"
            }`}
          >
            {tab.emoji} {tab.label}
          </button>
        );
      })}
    </div>
  );
}
