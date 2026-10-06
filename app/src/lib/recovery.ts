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

export type Candidate = { url: string; revision: number; time: number };

/** One ntfy frame to an authenticated address newer than the one this bot has, or null. */
export function candidateFrom(server: Server, event: any): Candidate | null {
  if (!event || event.event !== 'message' || event.topic !== server.recovery?.topic || typeof event.message !== 'string') return null;
  const decoded = decodeAddress(server, event.message);
  return decoded ? { ...decoded, time: Number.isSafeInteger(event.time) ? event.time : 0 } : null;
}

/** Whether this bot enrolled in recovery with a well-formed, HTTPS-only discovery endpoint. */
export function canRecover(server: Server): boolean {
  const recovery = server.recovery;
  if (!recovery || !/^winglet-address-[a-f0-9]{32}$/.test(recovery.topic)) return false;
  try {
    const endpoint = new URL(recovery.server);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash;
  } catch {
    return false;
  }
}

/**
 * Prove a decoded address belongs to this server before trusting it. Returns null when it answers as a
 * different server; throws when it can't be reached yet (a brand-new tunnel may take a moment).
 */
export async function verifyCandidate(server: Server, candidate: Candidate): Promise<Server | null> {
  // Never send the saved token until the encrypted URL has answered with the correct server ID.
  const info = await fetchInfo(candidate.url);
  if (info.server_id !== server.id) return null;
  const updated: Server = { ...server, url: candidate.url,
    recovery: { ...server.recovery!, revision: candidate.revision, ...(candidate.time ? { since: candidate.time } : {}) } };
  const me = await api<{ server_id: string; device: { id: string } }>(updated, '/api/me');
  if (me.server_id !== server.id || me.device.id !== server.deviceId) return null;
  return updated;
}

/** Parse an ntfy response (one JSON object per line). Oversized bodies yield nothing. */
export function parseFrames(text: string): any[] {
  if (text.length > 256 * 1024) return [];
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* ignore malformed ntfy frames */ }
  }
  return out;
}

type Member = {
  server: () => Server;
  recovered: (server: Server) => Promise<void> | void;
  recovering: (on: boolean) => void;
};

type Group = {
  endpoint: string;
  key: string;
  ids: string[];
  ws?: WebSocket;
  timer?: ReturnType<typeof setTimeout>;
  backoff: number;
  closed: boolean;
};

export type RecoveryEnv = {
  fetch: (url: string, init: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
  WebSocket: new (url: string) => WebSocket;
  setTimeout: (fn: () => void, ms: number) => any;
  clearTimeout: (timer: any) => void;
  now: () => number;
  random: () => number;
};

export const WINDOW_MS = 120_000;
export const POLL_MS = 15_000;
export const RATE_LIMIT_MS = 60_000;
const REVERIFY_MS = 3_000;

/**
 * Finds every bot's new address with as little traffic as possible. One live ntfy subscription per
 * ntfy server covers all recovering bots, so an announcement arrives the moment it's published. If
 * that can't open, one poll per ntfy server covers them all, with jitter and 429 backoff. Runs only
 * while the app is visible and the phone is online; each request for a bot lasts two minutes.
 */
export class RecoveryCoordinator {
  private members = new Map<string, Member>();
  private wanted = new Map<string, number>();
  private candidates = new Map<string, Candidate>();
  private verifying = new Set<string>();
  private groups = new Map<string, Group>();
  private foreground = true;
  private online = true;
  private expiry?: ReturnType<typeof setTimeout>;

  constructor(private env: RecoveryEnv = {
    fetch: (url, init) => fetch(url, init), WebSocket: globalThis.WebSocket,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t),
    now: () => Date.now(), random: Math.random,
  }) {}

  join(id: string, member: Member) {
    this.members.set(id, member);
  }

  leave(id: string) {
    this.members.delete(id);
    this.wanted.delete(id);
    this.candidates.delete(id);
    this.sync();
  }

  /** This bot can't be reached: look for a new address for the next two minutes. */
  want(id: string) {
    const member = this.members.get(id);
    if (!member || !canRecover(member.server())) return;
    const fresh = !this.wanted.has(id);
    this.wanted.set(id, this.env.now() + WINDOW_MS);
    if (fresh) member.recovering(true);
    this.sync();
  }

  /** The bot answered on its current address. */
  satisfied(id: string) {
    if (!this.wanted.delete(id)) return;
    this.candidates.delete(id);
    this.members.get(id)?.recovering(false);
    this.sync();
  }

  setForeground(on: boolean) {
    this.foreground = on;
    this.sync();
  }

  setOnline(on: boolean) {
    this.online = on;
    this.sync();
  }

  /** "Try now": poll at once instead of waiting for the next tick. */
  retryNow() {
    for (const group of this.groups.values()) {
      if (group.ws) continue;
      this.env.clearTimeout(group.timer);
      group.backoff = 0;
      this.poll(group);
    }
  }

  /** Bring the open subscriptions in line with which bots are recovering right now. */
  private sync() {
    const now = this.env.now();
    for (const [id, deadline] of [...this.wanted]) {
      if (deadline <= now) {
        this.wanted.delete(id);
        this.candidates.delete(id);
        this.members.get(id)?.recovering(false);
      }
    }
    const desired = new Map<string, string[]>();
    if (this.foreground && this.online) {
      for (const id of this.wanted.keys()) {
        const server = this.members.get(id)?.server();
        if (!server?.recovery) continue;
        const endpoint = server.recovery.server.replace(/\/$/, '');
        desired.set(endpoint, [...(desired.get(endpoint) ?? []), id]);
      }
    }
    for (const [endpoint, group] of [...this.groups]) {
      const ids = desired.get(endpoint);
      if (!ids || this.keyOf(ids) !== group.key) {
        this.closeGroup(group);
        this.groups.delete(endpoint);
      }
    }
    for (const [endpoint, ids] of desired) {
      if (!this.groups.has(endpoint)) this.openGroup(endpoint, ids);
    }
    this.env.clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.wanted.size) {
      const next = Math.min(...this.wanted.values());
      this.expiry = this.env.setTimeout(() => this.sync(), Math.max(0, next - now) + 10);
    }
  }

  private keyOf(ids: string[]) {
    return ids.map((id) => this.members.get(id)?.server().recovery?.topic ?? '').sort().join(',');
  }

  /** Oldest verified announcement among these bots, or "all" if any bot never recovered before. */
  private since(ids: string[]) {
    const times = ids.map((id) => this.members.get(id)?.server().recovery?.since);
    return times.every((t) => typeof t === 'number' && t > 0) ? String(Math.min(...(times as number[]))) : 'all';
  }

  private openGroup(endpoint: string, ids: string[]) {
    const group: Group = { endpoint, key: this.keyOf(ids), ids, backoff: 0, closed: false };
    this.groups.set(endpoint, group);
    let ws: WebSocket;
    try {
      ws = new this.env.WebSocket(`${endpoint.replace(/^https:/, 'wss:')}/${group.key}/ws?since=${this.since(ids)}`);
    } catch {
      this.poll(group);
      return;
    }
    group.ws = ws;
    ws.onmessage = (e: any) => {
      if (group.closed) return;
      for (const frame of parseFrames(String(e.data))) this.handle(group, frame);
    };
    ws.onclose = () => {
      if (group.closed || group.ws !== ws) return;
      group.ws = undefined;
      this.poll(group); // The live subscription failed or was cut: fall back to polling.
    };
    ws.onerror = () => undefined;
  }

  private closeGroup(group: Group) {
    group.closed = true;
    this.env.clearTimeout(group.timer);
    const ws = group.ws;
    group.ws = undefined;
    try { ws?.close(); } catch { /* already closed */ }
  }

  private schedule(group: Group, ms: number) {
    if (group.closed) return;
    this.env.clearTimeout(group.timer);
    group.timer = this.env.setTimeout(() => this.poll(group), ms);
  }

  private async poll(group: Group) {
    if (group.closed) return;
    let status = 0;
    const controller = new AbortController();
    const timer = this.env.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.env.fetch(`${group.endpoint}/${group.key}/json?poll=1&since=${this.since(group.ids)}`,
        { signal: controller.signal, redirect: 'error' });
      status = response.status;
      if (response.ok) for (const frame of parseFrames(await response.text())) this.handle(group, frame);
    } catch {
      /* offline or blocked: try again on the next tick */
    } finally {
      this.env.clearTimeout(timer);
    }
    if (status === 429) {
      group.backoff = Math.max(RATE_LIMIT_MS, group.backoff * 2);
      this.schedule(group, group.backoff);
    } else {
      group.backoff = 0;
      this.schedule(group, POLL_MS * (0.7 + this.env.random() * 0.6));
    }
  }

  private handle(group: Group, frame: any) {
    for (const id of group.ids) {
      const member = this.members.get(id);
      if (!member || !this.wanted.has(id)) continue;
      const candidate = candidateFrom(member.server(), frame);
      if (!candidate) continue;
      const have = this.candidates.get(id);
      if (!have || candidate.revision > have.revision) this.candidates.set(id, candidate);
      this.verify(id);
    }
  }

  private async verify(id: string) {
    if (this.verifying.has(id)) return;
    const member = this.members.get(id);
    const candidate = this.candidates.get(id);
    if (!member || !candidate || !this.wanted.has(id)) return;
    const server = member.server();
    this.verifying.add(id);
    let updated: Server | null = null;
    let reachable = true;
    try {
      updated = await verifyCandidate(server, candidate);
    } catch {
      reachable = false;
    } finally {
      this.verifying.delete(id);
    }
    // The bot was removed, re-paired or reconnected another way while this was in flight.
    if (this.members.get(id) !== member || member.server() !== server || !this.wanted.has(id)) return;
    if (updated) {
      this.candidates.delete(id);
      this.wanted.delete(id);
      member.recovering(false);
      await member.recovered(updated);
      this.sync();
    } else if (!reachable) {
      // A brand-new tunnel can take a few seconds to answer. Keep the candidate and try again.
      this.env.setTimeout(() => this.verify(id), REVERIFY_MS);
    } else if (this.candidates.get(id) === candidate) {
      this.candidates.delete(id); // Answered as a different server: never trust it.
    }
  }
}
