import { ChevronDown } from "lucide-react";

export type PickerOption = { id: string; label: string };

type ChannelPickerProps = {
  options: PickerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
};

// Native <select> so it stays fully accessible and gives iOS its big native wheel picker — the
// most senior-friendly, most reliable dropdown. Only the trigger is styled.
export default function ChannelPicker({ options, selectedId, onSelect }: ChannelPickerProps) {
  return (
    <label className="relative block">
      <span className="mb-2 block text-sm font-semibold uppercase tracking-wide text-white/50">
        Channel
      </span>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="min-h-[56px] w-full appearance-none rounded-2xl border border-white/15 bg-neutral-900 px-5 pr-12 text-xl font-semibold text-white focus:border-red-500 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-4 top-[calc(50%+0.5rem)] h-6 w-6 -translate-y-1/2 text-red-500"
        aria-hidden
      />
    </label>
  );
}
