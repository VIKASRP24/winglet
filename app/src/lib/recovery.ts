import { gcm } from '@noble/ciphers/aes.js';
import { fetch } from 'expo/fetch';
import { api, fetchInfo } from './api';
import type { Server } from './types';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytes(encoded: string): Uint8Array {
  if (typeof encoded !== 'string' || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid encoding');
  const out: number[] = [];
  let value = 0, bits = 0;
  for (const char of encoded) {
    value = (value << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); }
  }
  return Uint8Array.from(out);
}

export function decodeAddress(server: Server, message: string): { url: string; revision: number } | null {
  if (!server.recovery || message.length > 8192) return null;
  try {
    const envelope = JSON.parse(message);
    if (envelope.v !== 1) return null;
    const key = bytes(server.recovery.key), nonce = bytes(envelope.nonce);
    if (key.length !== 32 || nonce.length !== 12) return null;
    const aad = Uint8Array.from(`winglet.connection.v1:${server.id}:${server.deviceId}`, c => c.charCodeAt(0));
    const plaintext = gcm(key, nonce, aad).decrypt(bytes(envelope.ciphertext));
    if (plaintext.length > 2048) return null;
    // This protocol contains only ASCII identifiers, numbers and an HTTPS hostname.
    const data = JSON.parse(String.fromCharCode(...plaintext));
    if (data.server_id !== server.id || data.device_id !== server.deviceId ||
        !Number.isSafeInteger(data.revision) || data.revision <= server.recovery.revision ||
        typeof data.url !== 'string' || !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(data.url)) return null;
    return { url: data.url, revision: data.revision };
  } catch {
    return null; // A public ntfy topic can contain forged, stale, or unrelated messages.
  }
}

/** Only called by Android while reconnecting. No ntfy app, background service or phone VPN. */
export async function recoverAddress(server: Server): Promise<Server | null> {
  const recovery = server.recovery;
  if (!recovery || !/^winglet-address-[a-f0-9]{32}$/.test(recovery.topic)) return null;
  const endpoint = new URL(recovery.server);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${recovery.server.replace(/\/$/, '')}/${recovery.topic}/json?poll=1&since=all`,
      { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 256 * 1024) return null;
    let best: { url: string; revision: number } | null = null;
    for (const line of text.split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.event !== 'message' || event.topic !== recovery.topic || typeof event.message !== 'string') continue;
        const candidate = decodeAddress(server, event.message);
        if (candidate && (!best || candidate.revision > best.revision)) best = candidate;
      } catch { /* ignore malformed ntfy frames */ }
    }
    if (!best) return null;
    // Never send the saved token until the encrypted URL has answered with the correct server ID.
    const info = await fetchInfo(best.url);
    if (info.server_id !== server.id) return null;
    const updated = { ...server, url: best.url, recovery: { ...recovery, revision: best.revision } };
    const me = await api<{ server_id: string; device: { id: string } }>(updated, '/api/me');
    if (me.server_id !== server.id || me.device.id !== server.deviceId) return null;
    return updated;
  } finally {
    clearTimeout(timer);
  }
}
