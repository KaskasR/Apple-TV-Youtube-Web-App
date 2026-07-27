export type Chapter = {
  title: string;
  seconds: number;
};

// Matches a leading timestamp of the form M:SS, MM:SS, or H:MM:SS, optionally wrapped in
// brackets/parens, followed by an optional separator and the chapter title. Lines with no
// leading timestamp don't match and are skipped by the caller.
const TIMESTAMP_LINE = /^\s*[([]?(\d{1,2}):(\d{2})(?::(\d{2}))?[)\]]?\s*[-–—:.]*\s*(.*)$/;

function toSeconds(first: string, second: string, third: string | undefined): number {
  if (third !== undefined) {
    const hours = parseInt(first, 10);
    const minutes = parseInt(second, 10);
    const seconds = parseInt(third, 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
  const minutes = parseInt(first, 10);
  const seconds = parseInt(second, 10);
  return minutes * 60 + seconds;
}

// Scans a video description for chapter timestamp lines (as YouTube itself does for its native
// chapters UI) and returns them as an ordered list of { title, seconds }. Pure and network-free.
export function parseChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];

  for (const line of description.split("\n")) {
    const match = line.match(TIMESTAMP_LINE);
    if (!match) continue;

    const [, first, second, third, rest] = match;
    const title = rest.trim();
    if (!title) continue;

    chapters.push({ title, seconds: toSeconds(first, second, third) });
  }

  return chapters.sort((a, b) => a.seconds - b.seconds);
}

// Formats absolute seconds back into an M:SS or H:MM:SS label for display.
export function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
