import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { usePrefs } from './prefs';

/** Away longer than this and Winglet asks to unlock again. */
const GRACE_MS = 60_000;

type LockState = { locked: boolean; hiddenAt: number; unlocking: boolean };

/**
 * The app lock. It only guards this phone's screen (someone holding your unlocked phone); the
 * server's own protection is the device's role and signed owner actions, not this.
 */
export const useLock = create<LockState>(() => ({ locked: false, hiddenAt: 0, unlocking: false }));

const enabled = () => Platform.OS !== 'web' && usePrefs.getState().prefs.appLock;

/** Lock on a cold start when the lock is on. */
export function lockOnStart() {
  if (enabled()) useLock.setState({ locked: true });
}

export function onAppVisibility(visible: boolean) {
  if (!enabled()) return;
  const { hiddenAt, locked, unlocking } = useLock.getState();
  // The system's own unlock prompt briefly backgrounds the app: don't count that as leaving.
  if (unlocking) return;
  if (!visible) useLock.setState({ hiddenAt: Date.now() });
  else if (!locked && hiddenAt && Date.now() - hiddenAt > GRACE_MS) useLock.setState({ locked: true });
}

/** Whether this phone has a fingerprint, face or screen lock Winglet can use. */
export async function lockAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function unlock(prompt = 'Unlock Winglet'): Promise<boolean> {
  useLock.setState({ unlocking: true });
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
    if (result.success) useLock.setState({ locked: false, hiddenAt: 0 });
    return result.success;
  } catch {
    return false;
  } finally {
    useLock.setState({ unlocking: false });
  }
}
