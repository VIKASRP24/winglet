import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { gcm } from '@noble/ciphers/aes.js';
import ts from 'typescript';

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const topicA = 'winglet-address-' + 'a'.repeat(32);
const topicB = 'winglet-address-' + 'b'.repeat(32);
const server: any = { id: 'server-test', deviceId: 'phone-test', url: 'https://old.trycloudflare.com', token: 'device-token',
  recovery: { server: 'https://ntfy.sh', topic: topicA, key: Buffer.from(key).toString('base64url'), revision: 6 } };
const serverB: any = { ...server, id: 'server-b', recovery: { ...server.recovery, topic: topicB } };

/** Load recovery.ts with fake transport, a fake ntfy socket and a virtual clock. */
function harness(infoId = (url: string) => server.id) {
  const calls: any[] = [];
  const sockets: any[] = [];
  let pollBody = '';
  let pollStatus = 200;
  let infoFails = 0;
  let clock = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const exports: any = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/recovery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  class FakeWS {
    readyState = 0;
    onmessage?: (e: any) => void;
    onclose?: () => void;
    onerror?: () => void;
    closed = false;
    url: string;
    constructor(url: string) { this.url = url; sockets.push(this); }
    close() { this.closed = true; }
    frame(data: any) { this.onmessage?.({ data: JSON.stringify(data) }); }
    fail() { this.onclose?.(); }
  }
  const env = {
    fetch: async (url: string, options: any) => {
      calls.push({ kind: 'poll', url, options });
      return { ok: pollStatus < 300, status: pollStatus, text: async () => pollBody };
    },
    WebSocket: FakeWS,
    setTimeout: (fn: () => void, ms: number) => { const id = nextId++; timers.push({ at: clock + ms, fn, id }); return id; },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id); },
    now: () => clock,
    random: () => 0.5,
  };
  vm.runInNewContext(source, { exports, URL, AbortController, Uint8Array, setTimeout, clearTimeout,
    require: (id: string) => {
      if (id === '@noble/ciphers/aes.js') return { gcm };
      if (id === 'expo/fetch') return { fetch: env.fetch };
      if (id === './api') return {
        fetchInfo: async (url: string) => {
          calls.push({ kind: 'info', url });
          if (infoFails > 0) { infoFails--; throw new Error('not reachable yet'); }
          return { server_id: infoId(url) };
        },
        api: async (s: any) => { calls.push({ kind: 'auth', server: s }); return { server_id: s.id, device: { id: s.deviceId } }; },
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    ...exports, calls, sockets, env, tick,
    poll: (status: number, ...frames: any[]) => { pollStatus = status; pollBody = frames.map((f) => JSON.stringify(f)).join('\n'); },
    failInfo: (n: number) => { infoFails = n; },
    /** Advance the virtual clock, running every timer that falls due. */
    async advance(ms: number) {
      const end = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        clock = next.at;
        next.fn();
        await tick();
      }
      clock = end;
    },
  };
}

function message(overrides: any = {}, who = server) {
  const nonce = new Uint8Array(12).fill(9); // Fixed TEST vector only; production always generates new random nonces.
  const aad = new TextEncoder().encode(`winglet.connection.v1:${who.id}:${who.deviceId}`);
  const payload = new TextEncoder().encode(JSON.stringify({ server_id: who.id, device_id: who.deviceId,
    url: 'https://new-address.trycloudflare.com', revision: 7, ...overrides }));
  return JSON.stringify({ v: 1, nonce: Buffer.from(nonce).toString('base64url'),
    ciphertext: Buffer.from(gcm(key, nonce, aad).encrypt(payload)).toString('base64url') });
}

const frame = (msg: string, topic = topicA, time = 1000) => ({ id: 'x', event: 'message', topic, time, message: msg });

function member(h: any, initial: any) {
  const m: any = { current: initial, recovered: [] as any[], states: [] as boolean[] };
  m.api = { server: () => m.current, recovering: (on: boolean) => m.states.push(on),
    recovered: (s: any) => { m.current = s; m.recovered.push(s); } };
  return m;
}

test('Android cipher decrypts the real Python cryptography AES-GCM envelope', () => {
  const envelope = '{"v":1,"nonce":"w4A-WMMTeYtFXTde","ciphertext":"Iz3V3O08--351-ouR1Ll6MEGTDLjyiPY_lE_yWFIyIqfUWc9YAOBNYl1ZCD8dKAz3MGuqMT5NTRltIRZOQo2UpCwCWeY19FIsTkQ6MFmpBIaPQCQsJgo_YrSkX50lWONnevqkflBsaTTuzMKp3of5lr0suOq-ZMYAMGfUTzJk0eDcQbgBnlDNZ7yu0gsT6Xk0d29PhAD"}';
  const result = harness().decodeAddress(server, envelope);
  assert.equal(result.url, 'https://new-address.trycloudflare.com');
  assert.equal(result.revision, 7);
});

test('forged, stale, cross-device and non-HTTPS addresses are rejected', () => {
  const h = harness();
  assert.equal(h.decodeAddress(server, '{"v":1,"nonce":"AA","ciphertext":"AAAA"}'), null);
  assert.equal(h.decodeAddress({ ...server, deviceId: 'different' }, message()), null);
  assert.equal(h.decodeAddress({ ...server, id: 'different' }, message()), null);
  for (const overrides of [{ revision: 6 }, { revision: 1 }, { revision: 7.5 }, { device_id: 'other' },
    { url: 'http://new-address.trycloudflare.com' }, { url: 'https://new-address.trycloudflare.com.evil.example' },
    { url: 'https://new-address.trycloudflare.com/path' }]) assert.equal(h.decodeAddress(server, message(overrides)), null);
  const tampered = JSON.parse(message());
  tampered.ciphertext = (tampered.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
  assert.equal(h.decodeAddress(server, JSON.stringify(tampered)), null);
});

test('one live subscription covers every recovering bot on the same ntfy server', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server), b = member(h, serverB);
  c.join('a', a.api);
  c.join('b', b.api);
  c.want('a');
  c.want('b');
  const live = h.sockets.filter((s: any) => !s.closed);
  assert.equal(live.length, 1);
  assert.equal(live[0].url, `wss://ntfy.sh/${[topicA, topicB].sort().join(',')}/ws?since=all`);
  assert.equal(h.calls.length, 0);
});

test('an announcement on the subscription is verified, then adopted with its revision and time', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server);
  c.join('a', a.api);
  c.want('a');
  h.sockets[0].frame(frame('garbage'));
  h.sockets[0].frame(frame(message({ revision: 9, url: 'https://latest.trycloudflare.com' }), topicA, 4242));
  await h.tick();
  assert.equal(a.recovered.length, 1);
  assert.equal(a.current.url, 'https://latest.trycloudflare.com');
  assert.equal(a.current.token, server.token);
  assert.equal(a.current.recovery.revision, 9);
  assert.equal(a.current.recovery.since, 4242);
  assert.deepEqual(h.calls.map((x: any) => x.kind), ['info', 'auth']);
  assert.equal(h.sockets[0].closed, true); // nothing left to look for
  assert.equal(JSON.stringify(a.states), JSON.stringify([true, false]));
});

test('the next lookup only asks for announcements since the last verified one', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, { ...server, recovery: { ...server.recovery, since: 4242 } });
  c.join('a', a.api);
  c.want('a');
  assert.match(h.sockets[0].url, /\?since=4242$/);
});

test('wrong server ID never receives a saved bearer token', async () => {
  const h = harness(() => 'impostor');
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server);
  c.join('a', a.api);
  c.want('a');
  h.sockets[0].frame(frame(message()));
  await h.tick();
  assert.equal(a.recovered.length, 0);
  assert.deepEqual(h.calls.map((x: any) => x.kind), ['info']);
});

test('a new address that is not reachable yet is retried, not dropped', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server);
  c.join('a', a.api);
  c.want('a');
  h.failInfo(2);
  h.sockets[0].frame(frame(message()));
  await h.tick();
  assert.equal(a.recovered.length, 0);
  await h.advance(7000);
  assert.equal(a.recovered.length, 1);
  assert.equal(h.calls.filter((x: any) => x.kind === 'info').length, 3);
});

test('if the live subscription fails, one jittered poll per ntfy server covers all bots', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server), b = member(h, serverB);
  c.join('a', a.api);
  c.join('b', b.api);
  c.want('a');
  c.want('b');
  h.poll(200);
  h.sockets.at(-1).fail();
  await h.tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, `https://ntfy.sh/${[topicA, topicB].sort().join(',')}/json?poll=1&since=all`);
  assert.equal(h.calls[0].options.redirect, 'error');
  assert.equal(h.calls[0].options.headers, undefined);
  await h.advance(14_000);
  assert.equal(h.calls.length, 1);
  await h.advance(2_000); // 15s with this test's fixed jitter
  assert.equal(h.calls.length, 2);
  h.poll(200, frame(message(), topicA));
  await h.advance(15_000);
  assert.equal(a.recovered.length, 1);
  assert.equal(b.recovered.length, 0);
});

test('a 429 from ntfy backs off for at least a minute', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server);
  c.join('a', a.api);
  c.want('a');
  h.poll(429);
  h.sockets[0].fail();
  await h.tick();
  await h.advance(59_000);
  assert.equal(h.calls.length, 1);
  await h.advance(2_000);
  assert.equal(h.calls.length, 2);
});

test('nothing runs while the app is in the background or the phone is offline', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server);
  c.join('a', a.api);
  c.setForeground(false);
  c.want('a');
  assert.equal(h.sockets.length, 0);
  c.setForeground(true);
  assert.equal(h.sockets.length, 1);
  c.setOnline(false);
  assert.equal(h.sockets[0].closed, true);
  c.setOnline(true);
  assert.equal(h.sockets.filter((s: any) => !s.closed).length, 1);
});

test('looking stops two minutes after the last request, or as soon as the bot answers', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  const a = member(h, server), b = member(h, serverB);
  c.join('a', a.api);
  c.join('b', b.api);
  c.want('a');
  await h.advance(121_000);
  assert.equal(h.sockets[0].closed, true);
  c.want('b');
  const open = h.sockets.at(-1);
  c.satisfied('b');
  assert.equal(open.closed, true);
});

test('old app connections without enrollment and insecure discovery endpoints never look', async () => {
  const h = harness();
  const c = new h.RecoveryCoordinator(h.env);
  c.join('a', member(h, { ...server, recovery: undefined }).api);
  c.join('b', member(h, { ...server, recovery: { ...server.recovery, server: 'http://ntfy.sh' } }).api);
  c.join('c', member(h, { ...server, recovery: { ...server.recovery, topic: 'not-a-winglet-topic' } }).api);
  c.want('a');
  c.want('b');
  c.want('c');
  assert.equal(h.sockets.length, 0);
  assert.equal(h.calls.length, 0);
});
