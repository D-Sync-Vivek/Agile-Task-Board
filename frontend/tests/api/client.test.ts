import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "@/lib/api/client";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
}

function clientWith(fetchImpl: typeof fetch, baseUrl = "http://api.test") {
  return createApiClient({ baseUrl, fetchImpl });
}

describe("createApiClient: requests", () => {
  it("sends credentials, builds the URL, and unwraps { success, data }", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { hello: "world" } }));
    const result = await clientWith(fetchImpl as unknown as typeof fetch).get<{ hello: string }>("/api/ping");

    expect(result).toEqual({ hello: "world" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/ping");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include"); // required for the HTTP-only auth cookie
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: null }));
    await clientWith(fetchImpl as unknown as typeof fetch, "http://api.test///").get("/x");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://api.test/x");
  });

  it("sends JSON bodies with a Content-Type header for post and patch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: null }));
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    await client.post("/a", { n: 1 });
    await client.patch("/b", { s: "x" });

    for (const [call, method, body] of [
      [0, "POST", '{"n":1}'],
      [1, "PATCH", '{"s":"x"}'],
    ] as const) {
      const init = (fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1];
      expect(init.method).toBe(method);
      expect(init.body).toBe(body);
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
    }
  });

  it("sends DELETE and body-less POST without a body or content type", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: null }));
    const client = clientWith(fetchImpl as unknown as typeof fetch);
    await client.delete("/a");
    await client.post("/logout");
    for (const call of [0, 1]) {
      const init = (fetchImpl.mock.calls[call] as unknown as [string, RequestInit])[1];
      expect(init.body).toBeUndefined();
      expect(init.headers).toBeUndefined();
    }
  });

  it("passes an AbortSignal through to fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: null }));
    const controller = new AbortController();
    await clientWith(fetchImpl as unknown as typeof fetch).get("/x", { signal: controller.signal });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(controller.signal);
  });
});

describe("createApiClient: errors", () => {
  it("turns the backend error envelope into an ApiError (status, code, message, details)", async () => {
    const details = [{ field: "email", message: "Enter a valid email address" }];
    const fetchImpl = async () =>
      jsonResponse({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid request data", details } }, { status: 422 });

    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .post("/api/auth/register", {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR", message: "Invalid request data", details });
  });

  it("handles a non-JSON error body (e.g. an HTML 502 from a proxy) without crashing", async () => {
    const fetchImpl = async () => new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" });
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .get("/x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: "HTTP_502", message: "Bad Gateway" });
  });

  it("maps a network failure to ApiError(0, NETWORK_ERROR)", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .get("/x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("rethrows an aborted request untouched so callers can ignore it", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const fetchImpl = async () => {
      throw abort;
    };
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .get("/x")
      .catch((e: unknown) => e);
    expect(error).toBe(abort);
    expect(error).not.toBeInstanceOf(ApiError);
  });

  it("rejects a 2xx response that isn't the expected envelope", async () => {
    for (const make of [() => jsonResponse({ ok: true }), () => new Response("not json", { status: 200 }), () => jsonResponse({ success: true })]) {
      const error = await clientWith((async () => make()) as unknown as typeof fetch)
        .get("/x")
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("does not treat success:false with a 2xx status as success", async () => {
    const fetchImpl = async () => jsonResponse({ success: false, data: { leaked: true } });
    const error = await clientWith(fetchImpl as unknown as typeof fetch)
      .get("/x")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
