import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the production hook with deterministic focus, React dependencies and transport.
function harness(synced = true) {
  const server = { id: 'gateway' };
  const state: any = { network: true, foreground: true, runtime: { gateway: {
    status: 'online', me: { role: 'owner' }, projects: { projects: [{ id: 'p', revision: 1 }] },
    info: { features: { projects: true, rooms: true, project_rooms: true, project_rooms_sync: synced } },
  } } };
  const slots: any[] = [];
  let cursor = 0, focused = true;
  let effect: (() => void | (() => void)) | undefined;
  let previous: typeof effect;
  let cleanup: void | (() => void);
  const requests: { resolve: (rooms: any[]) => void; reject: (error: Error) => void }[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const modules: any = {
    react: {
      useState: (initial: any) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
      },
      useCallback: (callback: any, dependencies: any[]) => {
        const index = cursor++;
        if (!slots[index] || dependencies.some((dep, i) => !Object.is(dep, slots[index].dependencies[i]))) {
          slots[index] = { callback, dependencies };
        }
        return slots[index].callback;
      },
    },
    'expo-router': { useFocusEffect: (callback: any) => { effect = callback; } },
    '../../lib/store': { useApp: (selector: any) => selector(state) },
    './model': { projectRoomsSupported: (flags: any) => !!(flags?.projects && flags?.rooms && flags?.project_rooms) },
    './projectRoomsApi': { loadProjectRooms: () => new Promise((resolve, reject) => {
      requests.push({ resolve: rooms => resolve({ rooms }), reject });
    }) },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/features/rooms/useProjectRooms.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (id: string) => modules[id],
    setTimeout: (fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const render = () => {
    cursor = 0;
    const value = exports.useProjectRooms(server);
    if (focused && effect !== previous) {
      cleanup?.(); previous = effect; cleanup = effect?.();
    }
    return value;
  };
  return { server, state, runtime: state.runtime.gateway, requests, timers, render,
    blur: () => { focused = false; cleanup?.(); cleanup = undefined; previous = undefined; },
    focus: () => { focused = true; render(); },
    tick: () => { const [id, fn] = timers.entries().next().value!; timers.delete(id); fn(); },
  };
}

const room = (title: string) => ({ id: 'room', title, project_id: 'p' });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('synced gateways load on project changes without polling during unrelated activity', async () => {
  const h = harness(); h.render();
  h.requests[0].resolve([room('Original')]); await flush();
  assert.equal(h.render().rooms[0].title, 'Original');
  h.runtime.typing = { chat: 123 }; h.render();
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);

  h.runtime.projects = { projects: [{ id: 'p', revision: 2 }] }; h.render();
  assert.equal(h.requests.length, 2);
  // Metadata-only project.sync has the same revision, but must still reload ACLs/titles.
  h.runtime.projects = { ...h.runtime.projects }; h.render();
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve([room('Renamed')]); await flush();
  h.requests[1].resolve([room('Stale')]); await flush();
  assert.equal(h.render().rooms[0].title, 'Renamed');
  assert.equal(h.timers.size, 0);
});

test('legacy gateways poll only while focused and never rearm after a late response', async () => {
  const h = harness(false); h.render();
  h.requests[0].resolve([room('Original')]); await flush();
  assert.equal(h.timers.size, 1);
  h.tick(); assert.equal(h.requests.length, 2);
  h.blur(); h.requests[1].resolve([room('Late')]); await flush();
  assert.equal(h.timers.size, 0);
  h.focus(); assert.equal(h.requests.length, 3);
  h.requests[2].resolve([]); await flush();
  assert.equal(h.timers.size, 1);
  h.blur(); assert.equal(h.timers.size, 0);
});

test('permission changes hide prior rows and discard outstanding owner responses', async () => {
  const h = harness(); h.render();
  h.requests[0].resolve([room('Owner only')]); await flush();
  assert.equal(h.render().rooms.length, 1);
  h.runtime.projects = { ...h.runtime.projects }; h.render();
  h.runtime.me = { role: 'member' };
  assert.equal(h.render().rooms.length, 0);
  h.requests[2].resolve([]); await flush();
  h.requests[1].resolve([room('Owner only')]); await flush();
  assert.equal(h.render().rooms.length, 0);
});

test('background, offline and unsupported views do not load; returning reloads once', async () => {
  const h = harness(); h.state.foreground = false; h.render();
  assert.equal(h.requests.length, 0);
  h.state.foreground = true; h.render(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve([room('Visible')]); await flush();
  h.runtime.status = 'connecting'; assert.equal(h.render().rooms.length, 0);
  h.runtime.status = 'online'; h.render(); assert.equal(h.requests.length, 2);
  h.runtime.info.features.project_rooms = false; h.render();
  h.requests[1].resolve([room('Late')]); await flush();
  assert.equal(h.render().rooms.length, 0);
  assert.equal(h.requests.length, 2);
  h.runtime.info.features.project_rooms = true; h.render();
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve([]); await flush();
  h.blur(); h.focus(); assert.equal(h.requests.length, 4);
});

test('a failed event-driven read can be retried without an idle request loop', async () => {
  const h = harness(); h.render();
  h.requests[0].reject(new Error('Temporary failure')); await flush();
  const failed = h.render();
  assert.equal(failed.error, 'Temporary failure');
  assert.equal(h.timers.size, 0);
  failed.reload(); h.render();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve([room('Recovered')]); await flush();
  assert.equal(h.render().error, '');
  assert.equal(h.render().rooms[0].title, 'Recovered');
});
