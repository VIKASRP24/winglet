// Hermes's past conversations, as the sessions browser shows them.
import type { SessionRow } from './types';

const SOURCES: Record<string, string> = { cli: 'Terminal', tui: 'Terminal', cron: 'Routine', winglet: 'Winglet', api: 'API',
  desktop: 'Desktop', web: 'Dashboard', whatsapp: 'WhatsApp', imessage: 'iMessage', sms: 'SMS' };

/** Where a conversation happened, as a word: "Telegram", "Terminal", "Routine". */
export function sourceLabel(source: string): string {
  const key = (source || '').toLowerCase();
  if (!key) return 'Unknown';
  return SOURCES[key] ?? key.split(/[_-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** A conversation's name: its title, else how it began, else its id. */
export function sessionTitle(row: Pick<SessionRow, 'title' | 'preview' | 'id'>): string {
  const title = (row.title || '').trim();
  if (title) return title;
  const preview = (row.preview || '').replace(/^\[[^\]]*\]\s*/, '').trim();
  return preview ? (preview.length > 60 ? `${preview.slice(0, 59)}…` : preview) : row.id;
}

/** A search snippet split into plain and matched parts (Hermes marks matches >>>like this<<<). */
export function markedParts(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const re = />>>([\s\S]*?)<<</g;
  let from = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > from) out.push({ text: snippet.slice(from, m.index), hit: false });
    if (m[1]) out.push({ text: m[1], hit: true });
    from = m.index + m[0].length;
  }
  if (from < snippet.length) out.push({ text: snippet.slice(from), hit: false });
  return out;
}
