import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

// Exercise the real store and helper with only transport/storage replaced. Expo native imports
// cannot run under node:test; compiling the production modules keeps the state transitions intact.
function harness() {
  let request: (...args: any[]) => Promise<any> = async () => ({ items: [], pending: 0 });
  let socket: any;
  class FakeSocket {
    readyState = 1;
    onmessage?: (event: any) => void;
    constructor() { socket = this; }
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
      WebSocket: FakeSocket, setTimeout: () => 0, clearTimeout: () => {},
      setInterval: () => 0, clearInterval: () => {},
    });
    return exports;
  }
  const helpers = compile('../src/lib/messages.ts', {});
  const { useApp: store } = compile('../src/lib/store.ts', {
    zustand: { create: (fn: any) => createStore(fn) },
    './messages': helpers,
    './api': { api: (...args: any[]) => request(...args), ApiError: class extends Error {}, wsUrl: () => 'ws://test' },
    './storage': { getJSON: async (_: any, fallback: any) => fallback, setJSON: async () => {} },
  });
  return {
    store, setRequest: (fn: typeof request) => { request = fn; },
    event: (data: any) => socket.event(data),
    async connect() {
      await store.getState().addServer({ id: 's', url: 'http://test', token: 'test', bot: { title: 'Test' } });
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
