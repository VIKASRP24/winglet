import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { usePrefs } from './prefs';

// One map so every screen feels the same. The iPhone web app can't vibrate (Safari has no Vibration
// API), so haptics are Android-only, and nothing relies on them to convey information.
const on = () => Platform.OS !== 'web' && usePrefs.getState().prefs.haptics;
const run = (fn: () => Promise<void>) => { if (on()) fn().catch(() => undefined); };

export const haptic = {
  /** Tab switch, picker change, chip toggle. */
  selection: () => run(() => Haptics.selectionAsync()),
  /** Send a message, open a menu. */
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Pull-to-refresh triggers. */
  soft: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  /** Approval sent, task or goal completed. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Denied, or an action failed. */
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
