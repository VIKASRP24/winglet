import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const exports: any = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/connection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, URL, require: () => ({}) });
const { connectionView, diagnosticReport, addressKind } = exports;

const rt = (over: any = {}) => ({ status: 'online', conn: { recovering: false, history: [] }, outbox: [], ...over });

test('each connection problem gets its own state and the right action', () => {
  assert.equal(connectionView(true, rt(), 'Bot').kind, 'online');
  assert.equal(connectionView(false, rt({ status: 'offline' }), 'Bot').kind, 'no-internet');
  const unreachable = connectionView(true, rt({ status: 'offline', conn: { recovering: false, history: [], nextRetryAt: 6000 } }), 'Bot', 1000);
  assert.equal(unreachable.kind, 'unreachable');
  assert.equal(unreachable.action, 'retry');
  assert.match(unreachable.detail, /in 5s/);
  assert.equal(connectionView(true, rt({ status: 'offline', conn: { recovering: true, history: [] } }), 'Bot').kind, 'recovering');
  const signedOut = connectionView(true, rt({ status: 'unauthorized' }), 'Bot');
  assert.equal(signedOut.kind, 'signed-out');
  assert.equal(signedOut.action, 'pair');
  assert.equal(connectionView(true, rt({ compat: 'update-server' }), 'Bot').kind, 'update-server');
  assert.equal(connectionView(true, rt({ compat: 'update-app' }), 'Bot').kind, 'update-app');
});

test('address kinds never reveal the address', () => {
  assert.equal(addressKind('https://quiet-river-lamp.trycloudflare.com'), 'automatic HTTPS (quick tunnel)');
  assert.equal(addressKind('http://192.168.1.20:8787'), 'local network');
  assert.equal(addressKind('https://box.tail1234.ts.net'), 'Tailscale');
  assert.equal(addressKind('https://agent.example.com'), 'custom domain');
});

test('the diagnostic report has states and versions but no secrets, addresses or messages', () => {
  const report = diagnosticReport({
    bot: 'Bot', url: 'https://secret-host-name.trycloudflare.com', recovery: true, network: true, appVersion: '0.1.3',
    appProtocol: 1, platform: 'android',
    rt: rt({ status: 'offline', info: { version: '0.1.3', hermes_version: '2026.9', protocol: 1 },
      conn: { recovering: false, lastError: 'connection lost', history: [{ t: 0, status: 'offline', note: 'connection lost' }] },
      outbox: [{ client_id: 'c', chat_id: 'general', text: 'my private message', created_at: 1 }] }),
  }, 10_000);
  assert.match(report, /app: 0\.1\.3/);
  assert.match(report, /hermes 2026\.9/);
  assert.match(report, /queued messages: 1/);
  assert.match(report, /10s ago\s+offline/);
  for (const secret of ['secret-host-name', 'my private message', 'token', 'general']) assert.equal(report.includes(secret), false, secret);
});
