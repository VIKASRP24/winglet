import { create } from 'zustand';
import { getJSON, setJSON } from './storage';
import type { AccentName } from './theme';

export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  accent: AccentName;
  /** Bubbles: your messages in accent bubbles, replies unboxed. Compact: everything left-aligned. */
  layout: 'bubbles' | 'compact';
  /** "system" follows the phone's accessibility setting. */
  motion: 'system' | 'reduce' | 'full';
  transparency: 'system' | 'reduce' | 'full';
  haptics: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', accent: 'iris', layout: 'bubbles', motion: 'system', transparency: 'system', haptics: true,
};

const KEY = 'winglet.prefs';

type PrefsState = { prefs: Prefs; loaded: boolean; load: () => Promise<void>; update: (patch: Partial<Prefs>) => void };

/** Appearance and feel, stored on this device only. */
export const usePrefs = create<PrefsState>((set, get) => ({
  prefs: DEFAULT_PREFS,
  loaded: false,
  load: async () => {
    const saved = await getJSON<Partial<Prefs>>(KEY, {});
    set({ prefs: { ...DEFAULT_PREFS, ...saved }, loaded: true });
  },
  update: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });
    setJSON(KEY, prefs);
  },
}));
