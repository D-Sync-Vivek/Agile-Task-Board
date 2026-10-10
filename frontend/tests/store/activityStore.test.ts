import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityStore } from "@/store/createActivityStore";
import { useAuthStore } from "@/store/useAuthStore";
import type { ActivityPage } from "@/types/api";
import { apiError, deferred, flush, makeActivity } from "../helpers/fixtures";

const entry = (id: string) => makeActivity(id, { action: "COLUMN_CREATED", entityType: "COLUMN", metadata: { columnTitle: id } });
const page = (ids: string[], nextCursor: string | null = null): ActivityPage => ({ activities: ids.map(entry), nextCursor });
const ids = (store: ReturnType<typeof createActivityStore>) => store.getState().entries.map((e) => e.id);

function setup() {
  const fetchPage = vi.fn();
  return { fetchPage, store: createActivityStore(fetchPage) };
}

beforeEach(() => {
  useAuthStore.setState({ status: "authenticated", user: { id: "u1", name: "Me", email: "m@x.io", avatar: null, createdAt: "" } });
});

describe("load", () => {
  it("loads the first page and stores the cursor", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValue(page(["a", "b"], "b"));
    await store.getState().load("board-1");
    expect(fetchPage).toHaveBeenCalledWith("board-1", { limit: 20 }, { signal: undefined });
    expect(store.getState()).toMatchObject({ scopeId: "board-1", status: "ready", nextCursor: "b" });
    expect(ids(store)).toEqual(["a", "b"]);
  });

  it("goes loading -> error with a message, and recovers on a retry", async () => {
    const { store, fetchPage } = setup();
    const d = deferred<ActivityPage>();
    fetchPage.mockReturnValueOnce(d.promise);
    const loading = store.getState().load("x");
    expect(store.getState().status).toBe("loading");
    d.reject(apiError(500, "INTERNAL_ERROR", "Boom"));
    await loading;
    expect(store.getState()).toMatchObject({ status: "error", error: "Boom" });

    fetchPage.mockResolvedValueOnce(page(["a"]));
    await store.getState().load("x");
    expect(store.getState().status).toBe("ready");
  });

  it("ignores a slow response for a scope that has since been replaced", async () => {
    const { store, fetchPage } = setup();
    const slow = deferred<ActivityPage>();
    fetchPage.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page(["fresh"]));
    const first = store.getState().load("task-1");
    await store.getState().load("task-2");
    slow.resolve(page(["stale"]));
    await first;
    expect(store.getState().scopeId).toBe("task-2");
    expect(ids(store)).toEqual(["fresh"]);
  });

  it("drops the response when the request was aborted", async () => {
    const { store, fetchPage } = setup();
    const controller = new AbortController();
    fetchPage.mockImplementation(async () => {
      controller.abort();
      return page(["a"]);
    });
    await store.getState().load("x", { signal: controller.signal });
    expect(store.getState().entries).toEqual([]);
  });

  it("marks the session anonymous on 401", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    await store.getState().load("x");
    expect(useAuthStore.getState().status).toBe("anonymous");
  });
});

describe("loadMore", () => {
  it("appends the next page using the cursor and stops when there is none", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValueOnce(page(["a", "b"], "b")).mockResolvedValueOnce(page(["c"], null));
    await store.getState().load("x");
    await store.getState().loadMore();
    expect(fetchPage).toHaveBeenLastCalledWith("x", { limit: 20, cursor: "b" });
    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(store.getState().nextCursor).toBeNull();

    await store.getState().loadMore(); // nothing left: no request
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does not duplicate entries if the server repeats one", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValueOnce(page(["a", "b"], "b")).mockResolvedValueOnce(page(["b", "c"]));
    await store.getState().load("x");
    await store.getState().loadMore();
    expect(ids(store)).toEqual(["a", "b", "c"]);
  });

  it("ignores a second call while one is in flight", async () => {
    const { store, fetchPage } = setup();
    const d = deferred<ActivityPage>();
    fetchPage.mockResolvedValueOnce(page(["a"], "a")).mockReturnValueOnce(d.promise);
    await store.getState().load("x");
    const first = store.getState().loadMore();
    await store.getState().loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    d.resolve(page(["b"]));
    await first;
    expect(ids(store)).toEqual(["a", "b"]);
  });

  it("keeps the entries and reports the error when it fails, and can be retried", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValueOnce(page(["a"], "a")).mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Nope")).mockResolvedValueOnce(page(["b"]));
    await store.getState().load("x");
    await store.getState().loadMore();
    expect(store.getState()).toMatchObject({ loadingMore: false, loadMoreError: "Nope", status: "ready" });
    expect(ids(store)).toEqual(["a"]);
    await store.getState().loadMore();
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.getState().loadMoreError).toBeNull();
  });
});

describe("refresh", () => {
  it("puts new entries on top without blanking the list", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValueOnce(page(["b", "a"]));
    await store.getState().load("x");
    const d = deferred<ActivityPage>();
    fetchPage.mockReturnValueOnce(d.promise);
    const refreshing = store.getState().refresh();
    expect(ids(store)).toEqual(["b", "a"]); // still shown while refreshing
    expect(store.getState().status).toBe("ready");
    d.resolve(page(["c", "b", "a"]));
    await refreshing;
    expect(ids(store)).toEqual(["c", "b", "a"]);
  });

  it("keeps pages the user already loaded, including the entry that slides past the first page boundary", async () => {
    const { store, fetchPage } = setup();
    // 2 per page for the test: first page [e5,e4] cursor e4, second page [e3,e2] cursor e2.
    fetchPage.mockResolvedValueOnce(page(["e5", "e4"], "e4")).mockResolvedValueOnce(page(["e3", "e2"], "e2"));
    await store.getState().load("x");
    await store.getState().loadMore();
    expect(ids(store)).toEqual(["e5", "e4", "e3", "e2"]);

    // e6 arrives: the server's newest page is now [e6,e5]; e4 has moved down and must not be lost.
    fetchPage.mockResolvedValueOnce(page(["e6", "e5"], "e5"));
    await store.getState().refresh();
    expect(ids(store)).toEqual(["e6", "e5", "e4", "e3", "e2"]);
    expect(store.getState().nextCursor).toBe("e2"); // paging continues from where the user was
  });

  it("silently keeps what it has when the refresh fails", async () => {
    const { store, fetchPage } = setup();
    fetchPage.mockResolvedValueOnce(page(["a"]));
    await store.getState().load("x");
    fetchPage.mockRejectedValueOnce(apiError(0, "NETWORK_ERROR", "offline"));
    await store.getState().refresh();
    expect(store.getState()).toMatchObject({ status: "ready", error: null });
    expect(ids(store)).toEqual(["a"]);
  });

  it("does nothing before the first page is ready", async () => {
    const { store, fetchPage } = setup();
    await store.getState().refresh();
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("a loadMore that was in flight during a refresh is discarded and can be repeated (loadingMore never sticks)", async () => {
    const { store, fetchPage } = setup();
    const more = deferred<ActivityPage>();
    fetchPage.mockResolvedValueOnce(page(["a"], "a")).mockReturnValueOnce(more.promise).mockResolvedValueOnce(page(["n", "a"], "a"));
    await store.getState().load("x");
    const loading = store.getState().loadMore();
    await store.getState().refresh();
    more.resolve(page(["z"]));
    await loading;
    await flush();
    expect(store.getState().loadingMore).toBe(false);
    expect(ids(store)).toEqual(["n", "a"]);
  });
});

describe("reset", () => {
  it("clears everything and discards a response that arrives afterwards", async () => {
    const { store, fetchPage } = setup();
    const d = deferred<ActivityPage>();
    fetchPage.mockReturnValueOnce(d.promise);
    const loading = store.getState().load("x");
    store.getState().reset();
    d.resolve(page(["late"]));
    await loading;
    expect(store.getState()).toMatchObject({ scopeId: null, status: "idle", entries: [] });
  });
});
