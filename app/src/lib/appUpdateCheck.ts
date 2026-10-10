import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { type AppUpdate, checkIsFresh, newestUpdate, type Release, RELEASES_URL } from './appUpdate';
import { getJSON, setJSON } from './storage';

const KEY = 'winglet.appUpdate';

type Saved = { checkedAt: number; current: string; update: AppUpdate | null };

type State = {
  update: AppUpdate | null;
  checking: boolean;
  checkedAt?: number;
  failed: boolean;
  /** Looks on GitHub at most twice a day unless forced. Android only: the web app comes from the server. */
  check: (force?: boolean) => Promise<void>;
};

export const appUpdateSupported = Platform.OS === 'android';

/** Whether a newer Android app is out on GitHub Releases. */
export const useAppUpdate = create<State>((set, get) => ({
  update: null,
  checking: false,
  failed: false,
  check: async (force = false) => {
    const current = Constants.expoConfig?.version ?? '';
    if (!appUpdateSupported || !current || get().checking) return;
    set({ checking: true });
    const saved = await getJSON<Saved | null>(KEY, null);
    if (!force && saved && checkIsFresh(saved, current, Date.now())) {
      set({ update: saved.update, checkedAt: saved.checkedAt, checking: false, failed: false });
      return;
    }
    try {
      const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const update = newestUpdate((await res.json()) as Release[], current);
      const checkedAt = Date.now();
      set({ update, checkedAt, checking: false, failed: false });
      await setJSON(KEY, { checkedAt, current, update } satisfies Saved);
    } catch {
      // Offline or rate-limited: keep what we knew and try again next time.
      set({ update: saved?.current === current ? saved.update : null, checking: false, failed: true });
    }
  },
}));
