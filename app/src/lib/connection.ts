import type { ServerState } from './store';

export type ConnKind = 'connecting' | 'online' | 'no-internet' | 'unreachable' | 'recovering' | 'signed-out' |
  'update-app' | 'update-server';

export type ConnView = {
  kind: ConnKind;
  title: string;
  detail: string;
  /** What the banner's button does, if anything. */
  action?: 'retry' | 'pair' | 'about';
  tone: 'ok' | 'info' | 'warn' | 'error';
};

/** One clear sentence about why a bot is or isn't reachable, and the one thing to do about it. */
export function connectionView(network: boolean, rt: ServerState | undefined, bot: string, now = Date.now()): ConnView {
  const status = rt?.status ?? 'connecting';
  if (status === 'unauthorized') {
    return { kind: 'signed-out', tone: 'error', action: 'pair', title: 'Signed out',
      detail: `${bot} no longer recognises this device. It was removed or its sign-in was reset. Pair again to reconnect.` };
  }
  if (rt?.compat === 'update-app') {
    return { kind: 'update-app', tone: 'warn', action: 'about', title: 'Update Winglet',
      detail: `${bot} runs a newer Winglet than this app understands. Install the latest app to keep everything working.` };
  }
  if (rt?.compat === 'update-server') {
    return { kind: 'update-server', tone: 'warn', action: 'about', title: 'Update Winglet on the server',
      detail: `${bot}'s Winglet plugin is too old for this app. On the server, run: hermes plugins update winglet` };
  }
  if (!network) {
    return { kind: 'no-internet', tone: 'warn', title: 'No internet',
      detail: "This phone is offline. Messages you send now are queued and go out when you're back." };
  }
  if (status === 'online') return { kind: 'online', tone: 'ok', title: 'Online', detail: '' };
  if (rt?.conn.recovering) {
    return { kind: 'recovering', tone: 'info', action: 'retry', title: `Finding ${bot}'s new address`,
      detail: 'The server restarted and got a new address. This usually takes a few seconds.' };
  }
  if (status === 'offline') {
    const next = rt?.conn.nextRetryAt;
    const secs = next ? Math.max(0, Math.ceil((next - now) / 1000)) : 0;
    return { kind: 'unreachable', tone: 'warn', action: 'retry', title: `Can't reach ${bot}`,
      detail: secs ? `Trying again in ${secs}s. Check that Hermes is running.` : 'Trying again now. Check that Hermes is running.' };
  }
  return { kind: 'connecting', tone: 'info', title: 'Connecting…', detail: '' };
}

/** What kind of address a bot uses, without revealing the address itself. */
export function addressKind(url: string): string {
  let host = '';
  try { host = new URL(url).hostname; } catch { return 'unknown'; }
  if (host.endsWith('.trycloudflare.com')) return 'automatic HTTPS (quick tunnel)';
  if (host.endsWith('.ts.net')) return 'Tailscale';
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local')) return 'local network';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return 'IP address';
  return 'custom domain';
}

type ReportInput = {
  bot: string;
  url: string;
  recovery: boolean;
  network: boolean;
  appVersion: string;
  appProtocol: number;
  platform: string;
  rt?: ServerState;
};

/**
 * A plain-text report to paste when asking for help. Deliberately excludes tokens, keys, addresses,
 * chat names and message text: only states, times and versions.
 */
export function diagnosticReport(r: ReportInput, now = Date.now()): string {
  const rt = r.rt;
  const view = connectionView(r.network, rt, r.bot, now);
  const ago = (t: number) => `${Math.round((now - t) / 1000)}s ago`;
  const lines = [
    'Winglet diagnostics',
    `app: ${r.appVersion} (protocol ${r.appProtocol}, ${r.platform})`,
    `server: winglet ${rt?.info?.version || 'unknown'}, hermes ${rt?.info?.hermes_version || 'unknown'}, protocol ${rt?.info?.protocol ?? 'unknown'}`,
    `state: ${view.kind}${rt?.compat ? ` (${rt.compat})` : ''}`,
    `network: ${r.network ? 'online' : 'offline'}`,
    `address: ${addressKind(r.url)}${r.recovery ? ', address recovery enrolled' : ''}`,
    `recovering: ${rt?.conn.recovering ? 'yes' : 'no'}`,
    `last error: ${rt?.conn.lastError ?? 'none'}`,
    `queued messages: ${rt?.outbox.filter((o) => !o.failed).length ?? 0}, failed: ${rt?.outbox.filter((o) => o.failed).length ?? 0}`,
    'history (newest last):',
    ...(rt?.conn.history ?? []).map((h) => `  ${ago(h.t)}  ${h.status}${h.note ? ` (${h.note})` : ''}`),
  ];
  return lines.join('\n');
}
