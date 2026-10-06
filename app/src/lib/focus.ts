import { useSyncExternalStore } from 'react';

/**
 * A message to bring into view the next time its chat is on screen (from search). Kept outside the
 * store: it's a one-shot request, not state worth persisting or rendering anywhere else.
 */
type Request = { serverId: string; chatId: string; messageId: string; at: number };
let current: Request | null = null;
const listeners = new Set<() => void>();

export function requestFocus(serverId: string, chatId: string, messageId: string) {
  current = { serverId, chatId, messageId, at: Date.now() };
  listeners.forEach((l) => l());
}

/** Called once the message is in view (or can't be found), so it isn't jumped to again. */
export function clearFocus(messageId: string) {
  if (current?.messageId !== messageId) return;
  current = null;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The message this chat should scroll to, if one was asked for in the last minute. */
export function useFocusRequest(serverId: string, chatId: string): string | null {
  const req = useSyncExternalStore(subscribe, () => current, () => current);
  return req && req.serverId === serverId && req.chatId === chatId && Date.now() - req.at < 60000 ? req.messageId : null;
}
