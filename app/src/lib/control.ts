/** Formatting for the control center: sizes, durations, when a routine runs next, log levels. */

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "45s", "12m", "3h 12m", "2d 4h". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** When something next happens: "in 25 min", "today 9:00 AM", "tomorrow 9:00 AM", "Wed 9:00 AM", "Oct 30". */
export function whenNext(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const diff = (at.getTime() - now.getTime()) / 1000;
  if (diff < 60) return 'any moment';
  if (diff < 3600) return `in ${Math.round(diff / 60)} min`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86400000);
  if (days === 0) return `today ${time(at)}`;
  if (days === 1) return `tomorrow ${time(at)}`;
  if (days < 7) return `${at.toLocaleDateString([], { weekday: 'short' })} ${time(at)}`;
  return at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** The level of a Hermes log line ("2026-10-06 08:35:09,550 WARNING gateway.run: ..."). */
export function logLevel(line: string): LogLevel | null {
  const head = line.slice(0, 64);
  if (/ (ERROR|CRITICAL) /.test(head)) return 'error';
  if (/ WARNING /.test(head)) return 'warn';
  if (/ INFO /.test(head)) return 'info';
  if (/ DEBUG /.test(head)) return 'debug';
  return null;
}

/** Split a log line into its timestamp and the rest, so the time can be dimmed. */
export function splitLogLine(line: string): [string, string] {
  const m = /^(\d{4}-\d{2}-\d{2} )(\d{2}:\d{2}:\d{2})(,\d+)? (.*)$/.exec(line);
  return m ? [m[2], m[4]] : ['', line];
}

/** Hermes explains a schedule it can't read in several lines; the first says what was wrong. */
export function firstLine(message: string): string {
  return (message.split('\n')[0] || message).replace(/\.\s*Use:$/, '.').trim();
}

/** A key that makes a retried request (a flaky network) return the first job instead of starting a second. */
export function idempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}
