/**
 * Formatting helpers.
 *
 * Everything here is UTC-first and explicit about it. The server may run in
 * UTC while the visitor's browser does not, and an evidence timestamp that
 * shifts depending on who is looking at it would undermine the entire point of
 * the product.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "09:14:32 UTC" — the form used inline next to an observed fact. */
export function formatClockUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** "12 Sep 2026, 09:14 UTC" — the form used for a record's recorded-at time. */
export function formatDateTimeUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  const month = MONTHS[d.getUTCMonth()] ?? '';
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )} UTC`;
}

/** "2 min ago". Deterministic given `now`, which is what makes it testable. */
export function formatRelativeFrom(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'unknown';

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/**
 * Trims a URL down to something that fits on one line in a mono row without
 * hiding which host it is. The host is the part a skeptical reader needs.
 */
export function compactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname === '/' ? '' : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return raw;
  }
}

/** Money is a decimal string everywhere. Never parse it into a float to show it. */
export function formatAmount(amount: string, asset: string): string {
  return `${amount} ${asset}`;
}
