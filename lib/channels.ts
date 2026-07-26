export type ChannelConfig = {
  handle: string;
  label: string;
};

export type TabConfig = {
  id: string;
  label: string;
  emoji: string;
  channels: ChannelConfig[];
};

export const TABS: TabConfig[] = [
  {
    id: "news",
    label: "News",
    emoji: "📰",
    channels: [{ handle: "@zeteo", label: "Zeteo" }],
  },
  {
    id: "sports",
    label: "Sports",
    emoji: "🏐",
    channels: [
      { handle: "@volleyballworld", label: "Volleyball World" },
      { handle: "@RogerThatTennis", label: "Roger That Tennis" },
    ],
  },
];

export const UNIFIED_TAB_ID = "unified";

export function getAllChannels(): ChannelConfig[] {
  return TABS.flatMap((tab) => tab.channels);
}

export function getTabById(id: string): TabConfig | undefined {
  return TABS.find((tab) => tab.id === id);
}
