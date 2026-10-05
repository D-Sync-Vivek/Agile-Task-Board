/**
 * Validates a post-login redirect target taken from the URL (?next=...). Only same-site relative paths are allowed;
 * anything else (absolute URLs, //evil.com, /\evil.com, javascript:) falls back to "/" so the login page can't be
 * used as an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/"; // control characters / header-injection tricks
  return raw;
}
