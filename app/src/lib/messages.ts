import type { Message } from './types';

const isLocal = (m: Message) => m.status === 'pending' || m.status === 'failed';

/**
 * Merge a history snapshot into what the app already holds. Nothing the app knows is dropped (a live
 * reply may be newer than the snapshot; older pages stay loaded); for the same message the most
 * recently updated copy wins, and optimistic rows disappear once the server has confirmed them.
 */
export function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) {
    const have = byId.get(m.id);
    if (!have || m.updated_at >= have.updated_at) byId.set(m.id, m);
  }
  const confirmed = new Set<string>();
  for (const m of byId.values()) {
    if (!isLocal(m) && m.meta?.client_id) confirmed.add(m.meta.client_id);
  }
  return [...byId.values()]
    .filter((m) => !(isLocal(m) && m.meta?.client_id && confirmed.has(m.meta.client_id)))
    .sort((a, b) => a.created_at - b.created_at);
}

/** Mark an optimistic send as failed, unless the server already confirmed it (e.g. over the socket). */
export function markFailed(list: Message[], clientId: string): Message[] {
  return list.map((m) => (m.id === clientId && m.status === 'pending' ? { ...m, status: 'failed' } : m));
}
