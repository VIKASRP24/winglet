import { Platform } from 'react-native';
import type { Bot, Server } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Pull `{url, code}` out of a pairing link like `https://box.ts.net/#pair=ABCD2345`. */
export function parsePairLink(text: string): { url: string; code: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^(https?:\/\/[^\s#?]+?)\/?(?:\?[^#]*)?#pair=([A-Za-z0-9-]+)/);
  if (!match) return null;
  return { url: normalizeUrl(match[1]), code: normalizeCode(match[2]) };
}

async function request<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  let resp: Response;
  try {
    resp = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError("Can't reach the server. Check the address and that you're on the same network.", 0);
  }
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // non-JSON body
  }
  if (!resp.ok) throw new ApiError(data?.error || `Server returned ${resp.status}`, resp.status);
  return data as T;
}

export function api<T>(server: Server, path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(`${server.url}${path}`, { ...init, token: server.token });
}

export async function fetchInfo(url: string): Promise<{ server_id: string; bot: Bot; version: string }> {
  const info = await request<any>(`${url}/api/info`);
  if (info?.app !== 'winglet') throw new ApiError("That address answered, but it isn't a Winglet server.", 0);
  return info;
}

export async function pair(url: string, code: string, deviceName: string): Promise<Server> {
  const base = normalizeUrl(url);
  await fetchInfo(base);
  const data = await request<any>(`${base}/api/pair`, {
    method: 'POST',
    body: JSON.stringify({ code: normalizeCode(code), device_name: deviceName, platform: Platform.OS }),
  });
  return { id: data.server_id, url: base, token: data.token, deviceId: data.device.id, bot: data.bot, addedAt: Date.now() };
}

export function wsUrl(server: Server): string {
  return `${server.url.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(server.token)}`;
}

export function mediaUrl(server: Server, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${server.url}${path}${sep}token=${encodeURIComponent(server.token)}`;
}

export function defaultDeviceName(): string {
  if (Platform.OS === 'web') {
    const ua = globalThis.navigator?.userAgent ?? '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android browser';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return 'Browser';
  }
  return Platform.OS === 'android' ? 'Android phone' : 'iPhone';
}
