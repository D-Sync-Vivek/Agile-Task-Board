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
