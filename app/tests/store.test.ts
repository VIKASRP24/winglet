import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

// Exercise the real store and helper with only transport/storage replaced. Expo native imports
// cannot run under node:test; compiling the production modules keeps the state transitions intact.
function harness(os = 'web') {
  let request: (...args: any[]) => Promise<any> = async () => ({ items: [], pending: 0 });
  let socket: any;
  let recoveryRequest = async (_: any): Promise<any> => null;
  const timers: (() => void)[] = [];
  const sockets: string[] = [];
  let persisted: any;
  class FakeSocket {
    readyState = 1;
    onmessage?: (event: any) => void;
    onclose?: (event: any) => void;
    constructor(url: string) { socket = this; sockets.push(url); }
    send() {}
    close() {}
    event(data: any) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  function compile(file: string, imports: Record<string, any>) {
    const exports: any = {};
    const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, require: (id: string) => {
        if (id in imports) return imports[id];
        throw new Error(`Unexpected import ${id}`);
      },
      WebSocket: FakeSocket, setTimeout: (fn: () => void) => { timers.push(fn); return 0; }, clearTimeout: () => {},
      setInterval: () => 0, clearInterval: () => {},
    });
    return exports;
  }
  const helpers = compile('../src/lib/messages.ts', {});
  const { useApp: store } = compile('../src/lib/store.ts', {
    zustand: { create: (fn: any) => createStore(fn) },
    'react-native': { Platform: { OS: os } },
    './recovery': { recoverAddress: (s: any) => recoveryRequest(s) },
    './messages': helpers,
    './api': { api: (...args: any[]) => request(...args), ApiError: class extends Error {}, wsUrl: (s: any) => s.url },
    './storage': { getJSON: async (_: any, fallback: any) => fallback,
      setJSON: async (key: string, value: any) => { if (key === 'winglet.servers') persisted = value; } },
  });
  return {
    store, setRequest: (fn: typeof request) => { request = fn; },
    setRecovery: (fn: typeof recoveryRequest) => { recoveryRequest = fn; },
    disconnect: () => { socket.readyState = 3; socket.onclose?.({ code: 1006 }); },
    retry: () => timers.shift()?.(), sockets, persisted: () => persisted,
    event: (data: any) => socket.event(data),
    async connect() {
      await store.getState().addServer({ id: 's', url: 'http://test', token: 'test', bot: { title: 'Test' },
        ...(os === 'android' ? { recovery: { server: 'https://ntfy.sh', topic: 'private', key: 'secret', revision: 1 } } : {}) });
      store.getState().setVisibleChat({ serverId: 's', chatId: 'general' });
    },
    messages: () => store.getState().runtime.s.messages.general ?? [],
  };
}

const msg = (n: number) => ({ id: `m${n}`, position: n, chat_id: 'general', role: 'bot',
  text: String(n), status: 'final', meta: {}, created_at: 1, updated_at: 1 });

test('three equal-timestamp history pages advance through every server message', async () => {
  const h = harness();
  await h.connect();
  const all = Array.from({ length: 181 }, (_, i) => msg(i + 1));
  const cursors: (number | null)[] = [];
  h.setRequest(async (_, route) => {
    const raw = new URL(route, 'http://test').searchParams.get('before_position');
    const before = raw ? Number(raw) : null;
    cursors.push(before);
    const end = before ? all.findIndex(m => m.position === before) : all.length;
    return { messages: all.slice(Math.max(0, end - 60), end), deleted_ids: [] };
  });
  await h.store.getState().loadMessages('s', 'general');
  for (let i = 0; i < 3; i++) await h.store.getState().loadMessages('s', 'general', true);
  assert.deepEqual(cursors, [null, 122, 62, 2]);
  assert.equal(h.messages().length, 181);
  assert.equal(h.messages()[0].id, 'm1');
});

test('refresh applies missed offline deletions, including previously loaded older pages', async () => {
  const h = harness();
  await h.connect();
  h.setRequest(async () => ({ messages: [msg(1), msg(2), msg(3)], deleted_ids: [] }));
  await h.store.getState().loadMessages('s', 'general');
  h.setRequest(async () => ({ messages: [msg(3)], deleted_ids: ['m1'] }));
  await h.store.getState().loadMessages('s', 'general');
  assert.equal(JSON.stringify(h.messages().map((m: any) => m.id)), JSON.stringify(['m2', 'm3']));
});

test('live delete survives a stale in-flight snapshot and subsequent stale socket updates', async () => {
  const h = harness();
  await h.connect();
  let finish: any;
  h.setRequest(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.store.getState().loadMessages('s', 'general');
  h.event({ type: 'message.delete', chat_id: 'general', message_id: 'm1' });
  h.event({ type: 'message.new', chat_id: 'general', message: msg(2) });
  finish({ messages: [msg(1)], deleted_ids: [] });
  await pending;
  h.event({ type: 'message.update', chat_id: 'general', message: msg(1) });
  assert.equal(JSON.stringify(h.messages().map((m: any) => m.id)), JSON.stringify(['m2']));
});

test('WebSocket reconnect refresh removes deletions missed while offline', async () => {
  const h = harness();
  await h.connect();
  h.setRequest(async () => ({ messages: [msg(1), msg(2)], deleted_ids: [] }));
  await h.store.getState().loadMessages('s', 'general');
  h.setRequest(async (_, route) => route === '/api/inbox' ? { items: [], pending: 0 }
    : { messages: [msg(2)], deleted_ids: ['m1'] });
  h.event({ type: 'hello', chats: [{ id: 'general' }], pending: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.getState().runtime.s.status, 'online');
  assert.equal(JSON.stringify(h.messages().map((m: any) => m.id)), JSON.stringify(['m2']));
});

test('Android reconnect updates and persists a recovered URL without losing history or pairing', async () => {
  const h = harness('android');
  await h.connect();
  h.setRequest(async () => ({ messages: [msg(1)], deleted_ids: [] }));
  await h.store.getState().loadMessages('s', 'general');
  h.setRequest(async () => { throw new Error('old endpoint gone'); });
  h.setRecovery(async (s: any) => ({ ...s, url: 'https://new.trycloudflare.com', recovery: { ...s.recovery, revision: 2 } }));
  h.disconnect();
  h.retry();
  h.disconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.getState().servers[0].url, 'https://new.trycloudflare.com');
  assert.equal(h.persisted()[0].recovery.revision, 2);
  assert.equal(h.store.getState().servers[0].token, 'test');
  assert.equal(h.messages()[0].id, 'm1');
  assert.equal(h.sockets.at(-1), 'https://new.trycloudflare.com');
});

test('removing a server during recovery prevents a stale result from reconnecting it', async () => {
  const h = harness('android');
  await h.connect();
  h.setRequest(async () => { throw new Error('offline'); });
  let finish: any;
  h.setRecovery((s: any) => new Promise(resolve => { finish = () => resolve({ ...s, url: 'https://new.trycloudflare.com' }); }));
  h.disconnect(); h.retry(); h.disconnect();
  await new Promise(resolve => setImmediate(resolve));
  await h.store.getState().removeServer('s', false);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.getState().servers.length, 0);
  assert.equal(h.sockets.length, 2);
});
