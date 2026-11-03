import { create } from 'zustand';
import { api, signedApi } from './api';
import type { Server } from './types';

const key = (server: Server, chatId: string) => JSON.stringify([server.id, chatId]);
const path = (chatId: string) => `/api/chats/${encodeURIComponent(chatId)}/approval-bypass`;
// An older read must not overwrite a newer mutation or a newer read.
const revisions: Record<string, number> = {};

type State = {
  enabled: Record<string, boolean | undefined>;
  refresh: (server: Server, chatId: string) => Promise<void>;
  enable: (server: Server, chatId: string, itemId: string) => Promise<void>;
  disable: (server: Server, chatId: string) => Promise<void>;
};

export const useApprovalBypass = create<State>((set) => ({
  enabled: {},
  refresh: async (server, chatId) => {
    const k = key(server, chatId), revision = revisions[k] = (revisions[k] ?? 0) + 1;
    const result = await api<{ enabled: boolean }>(server, path(chatId));
    if (revisions[k] === revision) set((s) => ({ enabled: { ...s.enabled, [k]: result.enabled === true } }));
  },
  enable: async (server, chatId, itemId) => {
    const k = key(server, chatId);
    revisions[k] = (revisions[k] ?? 0) + 1;
    await signedApi(server, 'POST', `/api/inbox/${encodeURIComponent(itemId)}/respond`, { choice: 'once', allow_all: true, chat_id: chatId });
    revisions[k]++;
    set((s) => ({ enabled: { ...s.enabled, [k]: true } }));
  },
  disable: async (server, chatId) => {
    const k = key(server, chatId);
    revisions[k] = (revisions[k] ?? 0) + 1;
    await signedApi(server, 'DELETE', path(chatId));
    revisions[k]++;
    set((s) => ({ enabled: { ...s.enabled, [k]: false } }));
  },
}));

export const bypassKey = key;
