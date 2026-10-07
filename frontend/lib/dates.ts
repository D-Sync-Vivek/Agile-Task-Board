/**
 * Display helpers for dates coming from the API.
 *  - a task's due date is a calendar date ("YYYY-MM-DD"): shown as that same day for everyone, never shifted by a
 *    time zone (new Date("2026-10-15") would be midnight UTC and can render as the 14th in the Americas);
 *  - created/updated are real instants (ISO timestamps): shown in the viewer's local time.
 */
interface FormatOptions {
  locale?: string;
  timeZone?: string;
}

export function formatDueDate(value: string, { locale }: FormatOptions = {}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return value;
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

export function formatTimestamp(iso: string, { locale, timeZone }: FormatOptions = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
}

/**
 * "Just now", "2 min ago", "3 h ago", "4 d ago", then a plain date. `now` is passed in (not read here) so the caller
 * controls when the text refreshes and tests are deterministic. A timestamp slightly in the future (clock skew) reads
 * as "Just now".
 */
export function formatRelativeTime(iso: string, now: number, { locale }: FormatOptions = {}): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(then).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}
