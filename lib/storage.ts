const STORAGE_KEY = "tv-guide:tv-session";

export type TvSession = {
  screenId: string;
  token: string;
  sid: string;
  gsessionid: string;
  rid: number;
  nextOfs: number;
};

export function loadSession(): TvSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TvSession;
  } catch {
    return null;
  }
}

export function saveSession(session: TvSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
