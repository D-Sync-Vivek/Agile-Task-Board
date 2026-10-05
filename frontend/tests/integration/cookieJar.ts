/** Node has no browser cookie jar: wrap global fetch so the session cookie from the backend is stored and replayed. */
export function installCookieJar() {
  const realFetch = globalThis.fetch;
  const jar = new Map<string, string>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await realFetch(input, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attrs] = cookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      const expired = attrs.some((a) => /^\s*expires=/i.test(a) && new Date(a.split("=")[1]).getTime() < Date.now());
      if (expired || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  }) as typeof fetch;
  return () => jar.clear();
}
