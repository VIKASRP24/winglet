import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const fallback: any = new Proxy(function () {}, { get: (_t, key) => key === 'then' ? undefined : fallback, apply: () => fallback });

function harness() {
  let cursor = 0;
  const states: any[] = [];
  const refs: any[] = [];
  const command = 'first line\n' + 'full command details\n'.repeat(40);
  const item = { id: 'request', chat_id: 'chat', kind: 'approval', status: 'pending', body: '', payload: { command, choices: ['once', 'always', 'deny'] } };
  const calls: string[] = [];
  const bypassCalls: string[] = [];
  let finish: (() => void) | undefined;
  const store = { servers: [{ id: 'bot' }], runtime: { bot: { owner: true, info: { features: { chat_approval_bypass: false } }, chats: { chat: { kind: 'chat', title: 'Release work' } }, inbox: { request: item } } }, loadInbox: async () => {}, toast: () => {}, respond: async (_server: string, _id: string, reply: any) => { calls.push(reply.choice); await new Promise<void>((resolve) => { finish = resolve; }); } };
  const bypass = { enabled: {}, enable: async (_server: any, chat: string, id: string) => { bypassCalls.push(`${chat}:${id}`); } };
  const useApprovalBypass = Object.assign((select: any) => select(bypass), { getState: () => bypass });
  const useApp = Object.assign((select: any) => select(store), { getState: () => store });
  const jsx = (type: any, props: any) => ({ type, props });
  const modules: Record<string, any> = {
    react: {
      useState: (value: any) => { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], (v: any) => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
      useRef: (value: any) => { const i = cursor++; return refs[i] ??= { current: value }; },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '../lib/store': { useApp, isOwner: (runtime: any) => runtime?.owner },
    '../lib/approvalBypass': { useApprovalBypass, bypassKey: () => 'chat' },
    '../lib/themeContext': { makeStyles: () => () => fallback, useTheme: () => fallback },
    './ui': { Button: 'Button' }, './Sheet': { Sheet: 'Sheet' },
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/components/InboxCards.tsx', import.meta.url), 'utf8') + '\nexport { ApprovalCard };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require: (id: string) => modules[id] ?? fallback });
  const render = () => { cursor = 0; return exports.ApprovalCard({ serverId: 'bot', item, compact: true, embedded: true }); };
  return { render, item, calls, bypassCalls, store, command, finish: () => finish?.() };
}

test('expanding a compact approval exposes the full command without responding', () => {
  const h = harness();
  h.render().props.children[1].props.children[1].props.onPress();
  const scroll = h.render().props.children[1].props.children[0];
  assert.equal(scroll.type, 'ScrollView');
  assert.equal(scroll.props.children.props.children, h.command);
  assert.equal(scroll.props.children.props.numberOfLines, undefined);
  assert.deepEqual(h.calls, []);
});

test('Always allow opens confirmation and cannot submit from the first tap', () => {
  const h = harness();
  h.render().props.children[2].props.children.find((b: any) => b.props.title === 'Always allow').props.onPress();
  const sheet = h.render().props.children[3];
  assert.equal(sheet.props.visible, true);
  assert.deepEqual(h.calls, []);
});

test('smart denial explains guardian decision and only offers once or deny', () => {
  const h = harness();
  Object.assign(h.item.payload, { smart_denied: true, choices: ['once', 'session', 'always', 'deny'] });
  const card = h.render();
  const children = card.props.children;
  assert.equal(children[0].props.children[1].props.children[2].props.children, 'The Smart guardian blocked this command. You can allow it once or deny it.');
  const actions = children.find((child: any) => Array.isArray(child?.props?.children) && child.props.children.some((b: any) => b?.props?.title === 'Allow once'));
  assert.deepEqual(Array.from(actions.props.children, (b: any) => b.props.title), ['Allow once', 'Deny']);
});

test('allow everything requires an owner, a chat, the feature and an ordinary pending request', () => {
  const h = harness();
  const offered = () => !!h.render().props.children[2]?.props.children?.find?.((b: any) => b.props.title === 'Allow everything in this chat');
  assert.equal(offered(), false);
  h.store.runtime.bot.info.features.chat_approval_bypass = true;
  assert.equal(offered(), true);
  h.store.runtime.bot.owner = false;
  assert.equal(offered(), false);
  h.store.runtime.bot.owner = true;
  Object.assign(h.item.payload, { smart_denied: true });
  assert.equal(offered(), false);
  Object.assign(h.item.payload, { smart_denied: false });
  h.store.runtime.bot.chats.chat.kind = 'home';
  assert.equal(offered(), false);
  h.store.runtime.bot.chats.chat.kind = 'room';
  assert.equal(offered(), false);
  delete (h.store.runtime.bot.chats as any).chat;
  assert.equal(offered(), false);
});

test('allow everything confirms before making one bypass call', async () => {
  const h = harness();
  h.store.runtime.bot.info.features.chat_approval_bypass = true;
  h.render().props.children[2].props.children.find((b: any) => b.props.title === 'Allow everything in this chat').props.onPress();
  const sheet = h.render().props.children[4];
  assert.equal(sheet.props.visible, true);
  assert.equal(sheet.props.children.props.children[0].props.children, 'This approves the current request. Future commands in “Release work” can run without asking until you turn approvals back on or the session ends. To undo this, choose Turn back on in the chat. Commands could change or delete files.');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.bypassCalls, []);
  await sheet.props.children.props.children[2].props.onPress();
  await Promise.resolve();
  assert.deepEqual(h.bypassCalls, ['chat:request']);
  assert.deepEqual(h.calls, []);
});

test('rapid approval taps submit once; a stale expired request cannot submit', async () => {
  const h = harness();
  const button = h.render().props.children[2].props.children[0];
  const first = button.props.onPress();
  await button.props.onPress();
  assert.deepEqual(h.calls, ['once']);
  h.finish(); await first;
  h.item.status = 'expired';
  await button.props.onPress();
  assert.deepEqual(h.calls, ['once']);
});
