import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { gcm } from '@noble/ciphers/aes.js';
import ts from 'typescript';

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const server: any = { id: 'server-test', deviceId: 'phone-test', url: 'https://old.trycloudflare.com', token: 'device-token',
  recovery: { server: 'https://ntfy.sh', topic: 'winglet-address-' + 'a'.repeat(32), key: Buffer.from(key).toString('base64url'), revision: 6 } };

function harness(infoId = server.id) {
  const calls: any[] = [];
  let body = '';
  const exports: any = {};
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/recovery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const transport = async (url: string, options: any) => {
    calls.push({ kind: 'ntfy', url, options });
    return { ok: true, text: async () => body };
  };
  vm.runInNewContext(source, { exports, URL, AbortController, Uint8Array,
    setTimeout: () => 0, clearTimeout: () => {},
    require: (id: string) => {
      if (id === '@noble/ciphers/aes.js') return { gcm };
      if (id === 'expo/fetch') return { fetch: transport };
      if (id === './api') return {
        fetchInfo: async (url: string) => { calls.push({ kind: 'info', url }); return { server_id: infoId }; },
        api: async (s: any) => { calls.push({ kind: 'auth', server: s }); return { server_id: server.id, device: { id: server.deviceId } }; },
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  return { ...exports, calls, messages: (...messages: string[]) => {
    body = messages.map(message => JSON.stringify({ event: 'message', topic: server.recovery.topic, message })).join('\n');
  } };
}

function message(overrides = {}) {
  const nonce = new Uint8Array(12).fill(9); // Fixed TEST vector only; production always generates new random nonces.
  const aad = new TextEncoder().encode(`winglet.connection.v1:${server.id}:${server.deviceId}`);
  const payload = new TextEncoder().encode(JSON.stringify({ server_id: server.id, device_id: server.deviceId,
    url: 'https://new-address.trycloudflare.com', revision: 7, ...overrides }));
  return JSON.stringify({ v: 1, nonce: Buffer.from(nonce).toString('base64url'),
    ciphertext: Buffer.from(gcm(key, nonce, aad).encrypt(payload)).toString('base64url') });
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

test('recover the newest authenticated URL, verify identity before sending the token, preserve pairing', async () => {
  const h = harness();
  h.messages(message(), 'garbage', message({ revision: 9, url: 'https://latest.trycloudflare.com' }), message({ revision: 8 }));
  const updated = await h.recoverAddress(server);
  assert.equal(updated.url, 'https://latest.trycloudflare.com');
  assert.equal(updated.token, server.token);
  assert.equal(updated.recovery.revision, 9);
  assert.deepEqual(h.calls.map((c: any) => c.kind), ['ntfy', 'info', 'auth']);
  assert.equal(h.calls[0].options.redirect, 'error');
  assert.equal(h.calls[0].options.headers, undefined);
});

test('wrong server ID never receives a saved bearer token', async () => {
  const h = harness('impostor');
  h.messages(message());
  assert.equal(await h.recoverAddress(server), null);
  assert.deepEqual(h.calls.map((c: any) => c.kind), ['ntfy', 'info']);
});

test('old app connections without enrollment and insecure discovery endpoints stay unchanged', async () => {
  const h = harness();
  assert.equal(await h.recoverAddress({ ...server, recovery: undefined }), null);
  assert.equal(await h.recoverAddress({ ...server, recovery: { ...server.recovery, server: 'http://ntfy.sh' } }), null);
  assert.equal(h.calls.length, 0);
});
