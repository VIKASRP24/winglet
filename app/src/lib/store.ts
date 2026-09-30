import { create } from 'zustand';
import { api, ApiError, wsUrl } from './api';
import { markFailed, mergeMessages } from './messages';
import { getJSON, setJSON } from './storage';
import type { Chat, ConnStatus, InboxItem, Message, Server } from './types';

const SERVERS_KEY = 'winglet.servers';
const SELECTION_KEY = 'winglet.selection';
const TYPING_TTL_MS = 8000;

export type Toast = { id: string; serverId: string; title: string; body: string; href?: string };

export type ServerState = {
  status: ConnStatus;
  chats: Record<string, Chat>;
  messages: Record<string, Message[]>;
  loaded: Record<string, boolean>;
  inbox: Record<string, InboxItem>;
  pending: number;
  typing: Record<string, number>;
};

type Selection = { serverId?: string; chatId?: string };

type AppState = {
  ready: boolean;
  servers: Server[];
  runtime: Record<string, ServerState>;
  selection: Selection;
  toasts: Toast[];
  foreground: boolean;
  visibleChat?: { serverId: string; chatId: string };
  init: () => Promise<void>;
  addServer: (server: Server) => Promise<void>;
  removeServer: (serverId: string, unpair?: boolean) => Promise<void>;
  select: (serverId?: string, chatId?: string) => void;
  setVisibleChat: (v?: { serverId: string; chatId: string }) => void;
  setForeground: (fg: boolean) => void;
  loadMessages: (serverId: string, chatId: string, older?: boolean) => Promise<void>;
  loadInbox: (serverId: string) => Promise<void>;
  sendMessage: (serverId: string, chatId: string, text: string, retryClientId?: string) => Promise<void>;
  respond: (serverId: string, itemId: string, reply: { choice?: string; answer?: string | string[] }) => Promise<void>;
  createChat: (serverId: string, title?: string) => Promise<Chat | undefined>;
  renameChat: (serverId: string, chatId: string, title: string) => Promise<void>;
  deleteChat: (serverId: string, chatId: string) => Promise<void>;
  dismissToast: (id: string) => void;
};

const emptyRuntime = (): ServerState => ({
  status: 'connecting', chats: {}, messages: {}, loaded: {}, inbox: {}, pending: 0, typing: {},
});

const connections = new Map<string, Connection>();

export const useApp = create<AppState>((set, get) => {
  const patch = (serverId: string, fn: (s: ServerState) => Partial<ServerState>) =>
    set((state) => {
      const current = state.runtime[serverId] ?? emptyRuntime();
      return { runtime: { ...state.runtime, [serverId]: { ...current, ...fn(current) } } };
    });

  const upsertMessage = (serverId: string, chatId: string, message: Message) =>
    patch(serverId, (s) => {
      const list = s.messages[chatId] ?? [];
      const clientId = message.meta?.client_id;
      const idx = list.findIndex((m) => m.id === message.id || (clientId && m.meta?.client_id === clientId));
      const next = idx >= 0 ? list.map((m, i) => (i === idx ? message : m)) : [...list, message];
      return { messages: { ...s.messages, [chatId]: next } };
    });

  const toast = (t: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({ toasts: [...state.toasts.slice(-2), { ...t, id }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  };

  const persist = () => setJSON(SERVERS_KEY, get().servers);

  const handleEvent = (serverId: string, ev: any) => {
    const server = get().servers.find((s) => s.id === serverId);
    switch (ev.type) {
      case 'hello': {
        const chats: Record<string, Chat> = {};
        for (const c of ev.chats as Chat[]) chats[c.id] = c;
        const typing: Record<string, number> = {};
        for (const chatId of ev.typing ?? []) typing[chatId] = Date.now() + TYPING_TTL_MS;
        patch(serverId, () => ({ status: 'online', chats, typing, pending: ev.pending ?? 0, loaded: {} }));
        if (server && ev.bot && JSON.stringify(ev.bot) !== JSON.stringify(server.bot)) {
          set((state) => ({ servers: state.servers.map((s) => (s.id === serverId ? { ...s, bot: ev.bot } : s)) }));
          persist();
        }
        get().loadInbox(serverId);
        const vis = get().visibleChat;
        if (vis?.serverId === serverId) get().loadMessages(serverId, vis.chatId);
        break;
      }
      case 'message.new':
      case 'message.update': {
        const m = ev.message as Message;
        upsertMessage(serverId, ev.chat_id, m);
        if (m.role === 'bot' && m.status === 'final') {
          patch(serverId, (s) => {
            const typing = { ...s.typing };
            delete typing[ev.chat_id];
            return { typing };
          });
        }
        const vis = get().visibleChat;
        const seeing = get().foreground && vis?.serverId === serverId && vis.chatId === ev.chat_id;
        if (ev.type === 'message.new' && m.role === 'bot' && !seeing && server) {
          const chat = get().runtime[serverId]?.chats[ev.chat_id];
          toast({ serverId, title: `${server.bot.title}${chat && chat.kind === 'chat' ? ` · ${chat.title}` : ''}`,
            body: m.text.slice(0, 140) || 'Sent an attachment', href: `/chat/${serverId}/${ev.chat_id}` });
        }
        break;
      }
      case 'message.delete':
        patch(serverId, (s) => ({
          messages: { ...s.messages, [ev.chat_id]: (s.messages[ev.chat_id] ?? []).filter((m) => m.id !== ev.message_id) },
        }));
        break;
      case 'chat.update':
        if (ev.chat) patch(serverId, (s) => ({ chats: { ...s.chats, [ev.chat.id]: ev.chat } }));
        break;
      case 'chat.delete':
        patch(serverId, (s) => {
          const chats = { ...s.chats };
          delete chats[ev.chat_id];
          return { chats };
        });
        break;
      case 'typing':
        patch(serverId, (s) => {
          const typing = { ...s.typing };
          if (ev.on) typing[ev.chat_id] = Date.now() + TYPING_TTL_MS;
          else delete typing[ev.chat_id];
          return { typing };
        });
        break;
      case 'inbox.new':
      case 'inbox.update': {
        const item = ev.item as InboxItem;
        patch(serverId, (s) => ({ inbox: { ...s.inbox, [item.id]: item }, pending: ev.pending ?? s.pending }));
        if (ev.type === 'inbox.new' && item.kind !== 'result' && server) {
          toast({ serverId, title: `${server.bot.title} · ${item.title}`, body: item.body.slice(0, 140), href: `/inbox` });
        }
        break;
      }
    }
  };

  const connect = (server: Server) => {
    connections.get(server.id)?.close();
    const conn = new Connection(server, {
      onEvent: (ev) => handleEvent(server.id, ev),
      onStatus: (status) => patch(server.id, () => ({ status })),
    });
    connections.set(server.id, conn);
    conn.open();
  };

  return {
    ready: false,
    servers: [],
    runtime: {},
    selection: {},
    toasts: [],
    foreground: true,

    init: async () => {
      if (get().ready) return;
      const servers = await getJSON<Server[]>(SERVERS_KEY, []);
      const selection = await getJSON<Selection>(SELECTION_KEY, {});
      const runtime: Record<string, ServerState> = {};
      for (const s of servers) runtime[s.id] = emptyRuntime();
      set({ servers, runtime, selection: selection.serverId ? selection : { serverId: servers[0]?.id }, ready: true });
      servers.forEach(connect);
    },

    addServer: async (server) => {
      const others = get().servers.filter((s) => s.id !== server.id);
      set((state) => ({
        servers: [...others, server],
        runtime: { ...state.runtime, [server.id]: emptyRuntime() },
        selection: { serverId: server.id, chatId: 'general' },
      }));
      await persist();
      await setJSON(SELECTION_KEY, get().selection);
      connect(server);
    },

    removeServer: async (serverId, unpair = true) => {
      const server = get().servers.find((s) => s.id === serverId);
      connections.get(serverId)?.close();
      connections.delete(serverId);
      if (server && unpair) {
        api(server, '/api/me', { method: 'DELETE' }).catch(() => undefined);
      }
      set((state) => {
        const runtime = { ...state.runtime };
        delete runtime[serverId];
        const servers = state.servers.filter((s) => s.id !== serverId);
        const selection = state.selection.serverId === serverId ? { serverId: servers[0]?.id } : state.selection;
        return { servers, runtime, selection };
      });
      await persist();
    },

    select: (serverId, chatId) => {
      set({ selection: { serverId, chatId } });
      setJSON(SELECTION_KEY, { serverId, chatId });
    },

    setVisibleChat: (v) => set({ visibleChat: v }),

    setForeground: (fg) => {
      set({ foreground: fg });
      connections.forEach((c) => c.presence(fg));
      if (fg) connections.forEach((c) => c.ensureOpen());
    },

    loadMessages: async (serverId, chatId, older = false) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return;
      const existing = get().runtime[serverId]?.messages[chatId] ?? [];
      // Page from the oldest message the server knows (optimistic rows have no server position).
      const oldest = existing.find((m) => m.status !== 'pending' && m.status !== 'failed');
      const before = older && oldest ? `&before_id=${encodeURIComponent(oldest.id)}` : '';
      try {
        const data = await api<{ messages: Message[] }>(server, `/api/chats/${encodeURIComponent(chatId)}/messages?limit=60${before}`);
        patch(serverId, (s) => ({
          messages: { ...s.messages, [chatId]: mergeMessages(s.messages[chatId] ?? [], data.messages) },
          loaded: { ...s.loaded, [chatId]: true },
        }));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) patch(serverId, () => ({ status: 'unauthorized' }));
      }
    },

    loadInbox: async (serverId) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return;
      try {
        const data = await api<{ items: InboxItem[]; pending: number }>(server, '/api/inbox');
        const inbox: Record<string, InboxItem> = {};
        for (const item of data.items) inbox[item.id] = item;
        patch(serverId, () => ({ inbox, pending: data.pending }));
      } catch {
        // offline: keep what we have
      }
    },

    sendMessage: async (serverId, chatId, text, retryClientId) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server || !text.trim()) return;
      // A retry reuses the original id so the server can tell it already has the message.
      const clientId = retryClientId ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now() / 1000;
      const optimistic: Message = {
        id: clientId, chat_id: chatId, role: 'user', text: text.trim(), status: 'pending',
        meta: { client_id: clientId }, created_at: now, updated_at: now,
      };
      upsertMessage(serverId, chatId, optimistic);
      try {
        const data = await api<{ message: Message }>(server, `/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: 'POST', body: JSON.stringify({ text: text.trim(), client_id: clientId }),
        });
        upsertMessage(serverId, chatId, data.message);
      } catch {
        patch(serverId, (s) => ({ messages: { ...s.messages, [chatId]: markFailed(s.messages[chatId] ?? [], clientId) } }));
      }
    },

    respond: async (serverId, itemId, reply) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return;
      try {
        const data = await api<{ item: InboxItem }>(server, `/api/inbox/${itemId}/respond`, {
          method: 'POST', body: JSON.stringify(reply),
        });
        patch(serverId, (s) => ({ inbox: { ...s.inbox, [itemId]: data.item } }));
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          get().loadInbox(serverId);
          toast({ serverId, title: 'Too late', body: 'That request already expired or was answered elsewhere.' });
        } else {
          toast({ serverId, title: "Couldn't send", body: (e as Error).message });
        }
      }
    },

    createChat: async (serverId, title) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return undefined;
      const data = await api<{ chat: Chat }>(server, '/api/chats', { method: 'POST', body: JSON.stringify({ title }) });
      patch(serverId, (s) => ({ chats: { ...s.chats, [data.chat.id]: data.chat }, loaded: { ...s.loaded, [data.chat.id]: true } }));
      return data.chat;
    },

    renameChat: async (serverId, chatId, title) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return;
      const data = await api<{ chat: Chat }>(server, `/api/chats/${encodeURIComponent(chatId)}`, {
        method: 'PATCH', body: JSON.stringify({ title }),
      });
      patch(serverId, (s) => ({ chats: { ...s.chats, [chatId]: data.chat } }));
    },

    deleteChat: async (serverId, chatId) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return;
      await api(server, `/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
      patch(serverId, (s) => {
        const chats = { ...s.chats };
        delete chats[chatId];
        return { chats };
      });
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  };
});

/** One WebSocket per paired server, with reconnect + backoff. */
class Connection {
  private ws?: WebSocket;
  private closed = false;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private visible = true;

  constructor(private server: Server, private cb: { onEvent: (ev: any) => void; onStatus: (s: ConnStatus) => void }) {}

  open() {
    if (this.closed) return;
    this.cb.onStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.server));
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.presence(this.visible);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ type: 'ping', t: Date.now() }), 20000);
    };
    ws.onmessage = (e) => {
      try {
        this.cb.onEvent(JSON.parse(String(e.data)));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = undefined;
      if (this.closed) return;
      // The server rejects the upgrade with 401 when this device was unpaired.
      if (e.code === 1008 || e.code === 4401) {
        this.cb.onStatus('unauthorized');
        return;
      }
      this.cb.onStatus('offline');
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry() {
    clearTimeout(this.timer);
    const delay = Math.min(30000, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
    this.attempt += 1;
    if (this.attempt > 3) this.probeAuth();
    this.timer = setTimeout(() => this.open(), delay);
  }

  private async probeAuth() {
    try {
      await api(this.server, '/api/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        this.closed = true;
        this.cb.onStatus('unauthorized');
      }
    }
  }

  ensureOpen() {
    if (!this.closed && !this.ws) {
      clearTimeout(this.timer);
      this.attempt = 0;
      this.open();
    }
  }

  send(data: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(data));
  }

  presence(visible: boolean) {
    this.visible = visible;
    this.send({ type: 'presence', visible });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = undefined;
  }
}

export function isTyping(state: ServerState | undefined, chatId: string): boolean {
  const until = state?.typing[chatId];
  return !!until && until > Date.now();
}
