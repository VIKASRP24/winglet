import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Device tokens live in the OS keychain on Android/iOS. On the web there is no keychain; the web
// app is served by your own server, so its origin-scoped localStorage is the equivalent.

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // private mode / storage disabled: stay signed in for this tab only
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value));
}
