import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { useReducedMotion as useSystemReducedMotion } from 'react-native-reanimated';
import { usePrefs } from './prefs';

export const spring = {
  /** Buttons, toggles, chips. */
  snappy: { damping: 20, stiffness: 300, mass: 1 },
  /** Sheets, cards, the agent's face. */
  soft: { damping: 18, stiffness: 180, mass: 1 },
};

export const duration = { fast: 150, base: 250, slow: 400 };

/** True when animations should become short fades and loops should stop. */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const pref = usePrefs((s) => s.prefs.motion);
  return pref === 'reduce' || (pref === 'system' && system);
}

/** True when glass should be replaced by solid surfaces (readability, or slow blur). */
export function useReducedTransparency(): boolean {
  const pref = usePrefs((s) => s.prefs.transparency);
  const [system, setSystem] = useState(false);
  useEffect(() => {
    if (pref !== 'system') return;
    if (Platform.OS === 'web') {
      const mq = globalThis.matchMedia?.('(prefers-reduced-transparency: reduce)');
      setSystem(!!mq?.matches);
      return;
    }
    AccessibilityInfo.isReduceTransparencyEnabled?.().then(setSystem).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setSystem);
    return () => sub?.remove();
  }, [pref]);
  return pref === 'reduce' || (pref === 'system' && system);
}
