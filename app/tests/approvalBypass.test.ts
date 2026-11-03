import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const calls: any[] = [];
  let answer: any = { enabled: true };
  let wait: Promise<any> | undefined;
  const create = (initializer: any) => {
    let state: any;
    const set = (fn: any) => { state = { ...state, ...fn(state) }; };
    state = initializer(set);
    return Object.assign((selector: any) => selector(state), { getState: () => state });
  };
  const modules: Record<string, any> = {
    zustand: { create },
    './api': {
      api: async (_server: any, path: string) => { calls.push(['GET', path]); return wait ?? answer; },
      signedApi: async (_server: any, method: string, path: string, body: any) => { calls.push([method, path, body]); },
    },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/lib/approvalBypass.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (id: string) => modules[id] });
  const server = { id: 'bot' };
  return { ...exports, calls, server, setWait: (p: Promise<any>) => { wait = p; } };
}

test('enable is one signed request and bypass state is per chat', async () => {
  const h = harness();
  await h.useApprovalBypass.getState().enable(h.server, 'chat / 1', 'item-1');
  assert.equal(JSON.stringify(h.calls), JSON.stringify([['POST', '/api/inbox/item-1/respond', { choice: 'once', allow_all: true, chat_id: 'chat / 1' }]]));
  assert.equal(h.useApprovalBypass.getState().enabled[h.bypassKey(h.server, 'chat / 1')], true);
  assert.equal(h.useApprovalBypass.getState().enabled[h.bypassKey(h.server, 'other')], undefined);
});

test('turning approvals back on uses the signed delete route', async () => {
  const h = harness();
  await h.useApprovalBypass.getState().disable(h.server, 'chat');
  assert.equal(JSON.stringify(h.calls), JSON.stringify([['DELETE', '/api/chats/chat/approval-bypass', undefined]]));
});

test('banner is owner-only and Smart opens Tools without changing approvals', () => {
  const calls: any[] = [];
  const runtime = { info: { features: { chat_approval_bypass: true } }, status: 'online', inbox: {}, owner: true };
  const store = { runtime: { bot: runtime }, select: (...args: any[]) => calls.push(['select', ...args]) };
  const useApp = Object.assign((selector: any) => selector(store), { getState: () => store });
  const bypass = { enabled: { chat: true }, refresh: async () => {} };
  const useApprovalBypass = Object.assign((selector: any) => selector(bypass), { getState: () => bypass });
  const jsx = (type: any, props: any) => ({ type, props });
  const fallback: any = new Proxy(function () {}, { get: (_t, k) => k === 'then' ? undefined : fallback, apply: () => fallback });
  const modules: Record<string, any> = {
    'expo-router': { router: { push: (path: string) => calls.push(['push', path]) } },
    react: { useEffect: () => {}, useState: (value: any) => [value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text' },
    '../lib/approvalBypass': { useApprovalBypass, bypassKey: () => 'chat' },
    '../lib/store': { useApp, isOwner: (rt: any) => rt?.owner },
    '../lib/themeContext': { makeStyles: () => () => fallback },
    './ui': { Button: 'Button' },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/components/ApprovalBypassBanner.tsx', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (id: string) => modules[id] ?? fallback });
  const render = () => exports.ApprovalBypassBanner({ server: { id: 'bot' }, chatId: 'chat' });
  const banner = render();
  assert.equal(banner.props.children[0].props.children, 'Approvals off in this chat');
  banner.props.children[2].props.children[1].props.onPress();
  assert.deepEqual(calls, [['select', 'bot', 'chat'], ['push', '/tools']]);
  runtime.owner = false;
  assert.equal(render(), null);
});

test('a stale GET cannot hide a successful enable', async () => {
  const h = harness();
  let resolve!: (value: any) => void;
  h.setWait(new Promise((r) => { resolve = r; }));
  const read = h.useApprovalBypass.getState().refresh(h.server, 'chat');
  await h.useApprovalBypass.getState().enable(h.server, 'chat', 'item');
  resolve({ enabled: false });
  await read;
  assert.equal(h.useApprovalBypass.getState().enabled[h.bypassKey(h.server, 'chat')], true);
});
