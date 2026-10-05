import { SQLiteStorage } from 'expo-sqlite/kv-store';

// On-device cache for chats, recent messages, drafts and the outbox. Device tokens stay in the
// keychain (storage.ts); this holds only what the app can rebuild from the server.
const db = new SQLiteStorage('winglet-cache');

export async function cacheGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await db.getItemAsync(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await db.setItemAsync(key, JSON.stringify(value));
  } catch { /* a full or unavailable cache only costs offline reading */ }
}

export async function cacheRemove(prefix: string): Promise<void> {
  try {
    const keys = await db.getAllKeysAsync();
    await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => db.removeItemAsync(k)));
  } catch { /* ignore */ }
}
