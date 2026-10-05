import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const user = { id: "u1", name: "Vivek", email: "vivek@example.com", avatar: null, createdAt: "2026-10-04T00:00:00.000Z" };
const store = () => useAuthStore.getState();

beforeEach(() => {
  resetApiMock();
  useAuthStore.setState({ status: "unknown", user: null });
});

describe("fetchSession", () => {
  it("becomes authenticated when the cookie session is valid", async () => {
    api.auth.me.mockResolvedValueOnce({ user });
    const pending = store().fetchSession();
    expect(store().status).toBe("loading");
    await pending;
    expect(store()).toMatchObject({ status: "authenticated", user });
  });

  it("becomes anonymous on 401", async () => {
    api.auth.me.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await store().fetchSession();
    expect(store()).toMatchObject({ status: "anonymous", user: null });
  });

  it("becomes 'error' (not anonymous) when the server can't be reached, so users aren't bounced to /login", async () => {
    api.auth.me.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR"));
    await store().fetchSession();
    expect(store().status).toBe("error");
  });

  it("does not start a second request while one is loading", async () => {
    const d = deferred();
    api.auth.me.mockReturnValueOnce(d.promise);
    const first = store().fetchSession();
    await store().fetchSession();
    expect(api.auth.me).toHaveBeenCalledTimes(1);
    d.resolve({ user });
    await first;
  });
});

describe("login / register / logout", () => {
  it("login stores the user", async () => {
    api.auth.login.mockResolvedValueOnce({ user });
    await store().login({ email: user.email, password: "password123" });
    expect(store()).toMatchObject({ status: "authenticated", user });
  });

  it("a failed login throws for the form and leaves the session untouched", async () => {
    api.auth.login.mockRejectedValueOnce(apiError(401, "INVALID_CREDENTIALS", "Invalid email or password"));
    await expect(store().login({ email: "a@b.co", password: "x" })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(store().status).toBe("unknown");
    expect(store().user).toBeNull();
  });

  it("register stores the user; failure throws", async () => {
    api.auth.register.mockResolvedValueOnce({ user });
    await store().register({ name: "Vivek", email: user.email, password: "password123" });
    expect(store().status).toBe("authenticated");

    useAuthStore.setState({ status: "unknown", user: null });
    api.auth.register.mockRejectedValueOnce(apiError(409, "EMAIL_ALREADY_EXISTS"));
    await expect(store().register({ name: "V", email: user.email, password: "password123" })).rejects.toMatchObject({ code: "EMAIL_ALREADY_EXISTS" });
    expect(store().status).toBe("unknown");
  });

  it("logout clears the session even if the request fails", async () => {
    useAuthStore.setState({ status: "authenticated", user });
    api.auth.logout.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR"));
    await expect(store().logout()).rejects.toBeTruthy();
    expect(store()).toMatchObject({ status: "anonymous", user: null });
  });

  it("markAnonymous drops the session", () => {
    useAuthStore.setState({ status: "authenticated", user });
    store().markAnonymous();
    expect(store()).toMatchObject({ status: "anonymous", user: null });
  });
});
