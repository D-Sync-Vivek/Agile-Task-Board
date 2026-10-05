/**
 * Minimal typed HTTP client for the backend. Every backend response is either
 *   { success: true, data }  or  { success: false, error: { code, message, details? } }
 * and this module turns the second form (and network failures) into a thrown ApiError,
 * so callers only deal with `data` or one error type.
 *
 * Auth is an HTTP-only cookie set by the backend, so requests are sent with credentials and
 * this code never sees or stores a token.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number, // HTTP status, or 0 when the server could not be reached
    public readonly code: string, // machine-readable, e.g. "VALIDATION_ERROR", "NETWORK_ERROR"
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Injectable for tests (and for non-browser callers that need a cookie jar). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : (error as { name?: string })?.name === "AbortError";
}

export function createApiClient({ baseUrl, fetchImpl }: ApiClientConfig): ApiClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body: unknown, options?: RequestOptions): Promise<T> {
    const doFetch = fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${root}${path}`, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: options?.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error; // a cancelled request is not a failure; let the caller ignore it
      throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server. Check your connection and try again.");
    }

    // The body may be missing or not JSON (e.g. an HTML 502 page from a proxy); never let that crash error handling.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const envelope = payload as
      | { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } }
      | undefined;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        envelope?.error?.code ?? `HTTP_${response.status}`,
        envelope?.error?.message ?? (response.statusText || "Request failed"),
        envelope?.error?.details
      );
    }
    if (envelope?.success !== true || !("data" in envelope)) {
      throw new ApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected response.");
    }
    return envelope.data as T;
  }

  return {
    get: (path, options) => request("GET", path, undefined, options),
    post: (path, body, options) => request("POST", path, body, options),
    patch: (path, body, options) => request("PATCH", path, body, options),
    delete: (path, options) => request("DELETE", path, undefined, options),
  };
}
