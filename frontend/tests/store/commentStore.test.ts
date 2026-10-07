import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useToastStore } from "@/store/useToastStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred, flush, makeBoard, makeComment } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useCommentStore.getState();
const texts = () => store().comments.map((c) => c.content);
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const me = { id: "u1", name: "Vivek Kumar", email: "v@example.com", avatar: null, createdAt: "2026-10-04T00:00:00.000Z" };

async function loadTask(comments = [makeComment("c1", "u2", "Mia", "first"), makeComment("c2", "u1", "Vivek Kumar", "second")]) {
  api.comments.list.mockResolvedValueOnce({ comments });
  await store().load("t1");
}

beforeEach(() => {
  resetApiMock();
  store().reset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: me });
  useBoardStore.getState().reset();
});

describe("load", () => {
  it("loads a task's comments in the order the server sends them", async () => {
    api.comments.list.mockResolvedValueOnce({ comments: [makeComment("c1", "u2", "Mia", "first"), makeComment("c2", "u1", "Vivek Kumar", "second")] });
    const loading = store().load("t1");
    expect(store().status).toBe("loading");
    expect(store().taskId).toBe("t1");
    await loading;
    expect(store().status).toBe("ready");
    expect(texts()).toEqual(["first", "second"]);
  });

  it("clears the previous task's comments immediately when loading another", async () => {
    await loadTask();
    const d = deferred();
    api.comments.list.mockReturnValueOnce(d.promise);
    const loading = store().load("t2");
    expect(store().comments).toEqual([]);
    d.resolve({ comments: [] });
    await loading;
  });

  it("reports failures and a 401 ends the session", async () => {
    api.comments.list.mockRejectedValueOnce(apiError(404, "TASK_NOT_FOUND", "Task not found"));
    await store().load("t1");
    expect(store()).toMatchObject({ status: "error", error: "Task not found" });

    api.comments.list.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await store().load("t1");
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("ignores aborted and superseded responses", async () => {
    const slow = deferred();
    api.comments.list.mockReturnValueOnce(slow.promise);
    const controller = new AbortController();
    const first = store().load("t1", { signal: controller.signal });
    controller.abort();
    api.comments.list.mockResolvedValueOnce({ comments: [makeComment("c9", "u2", "Mia", "newer")] });
    await store().load("t2");
    slow.resolve({ comments: [makeComment("c1", "u2", "Mia", "stale")] });
    await first;
    expect(store().taskId).toBe("t2");
    expect(texts()).toEqual(["newer"]);
  });
});

describe("add (optimistic)", () => {
  it("shows the comment at once as pending, then swaps in the server's version in place", async () => {
    await loadTask();
    const d = deferred();
    api.comments.create.mockReturnValueOnce(d.promise);
    const adding = store().add("t1", "  Yes, I'll handle it.  ");

    expect(texts()).toEqual(["first", "second", "Yes, I'll handle it."]);
    expect(store().comments[2]).toMatchObject({ pending: true, author: { id: "u1", name: "Vivek Kumar" }, userId: "u1" });
    expect(api.comments.create).toHaveBeenCalledWith("t1", { content: "Yes, I'll handle it." });

    d.resolve({ comment: makeComment("c3", "u1", "Vivek Kumar", "Yes, I'll handle it.") });
    await adding;
    expect(store().comments.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(store().comments[2].pending).toBeUndefined();
  });

  it("removes the pending comment and throws on failure, so the composer can restore the text", async () => {
    await loadTask();
    api.comments.create.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await expect(store().add("t1", "lost?")).rejects.toMatchObject({ status: 500 });
    expect(texts()).toEqual(["first", "second"]);
  });

  it("a 401 ends the session", async () => {
    await loadTask();
    api.comments.create.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await expect(store().add("t1", "x")).rejects.toBeTruthy();
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(texts()).toEqual(["first", "second"]);
  });

  it("a 404 makes the board re-check itself (the task may be gone)", async () => {
    await loadTask();
    const { columns, tasks, ...meta } = makeBoard();
    useBoardStore.setState({ board: meta, columns, tasks, status: "ready" });
    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    api.comments.create.mockRejectedValueOnce(apiError(404, "TASK_NOT_FOUND", "Task not found"));
    await expect(store().add("t1", "x")).rejects.toMatchObject({ status: 404 });
    await flush();
    expect(api.boards.get).toHaveBeenCalledTimes(1);
  });

  it("does nothing for blank text, without a user, or for a task that isn't the open one", async () => {
    await loadTask();
    await store().add("t1", "   ");
    await store().add("t-other", "hello");
    useAuthStore.setState({ user: null });
    await store().add("t1", "hello");
    expect(api.comments.create).not.toHaveBeenCalled();
    expect(texts()).toEqual(["first", "second"]);
  });

  it("drops the response if the panel moved on while the request was in flight", async () => {
    await loadTask();
    const d = deferred();
    api.comments.create.mockReturnValueOnce(d.promise);
    const adding = store().add("t1", "late");
    store().reset();
    d.resolve({ comment: makeComment("c3", "u1", "Vivek Kumar", "late") });
    await adding;
    expect(store().comments).toEqual([]);
  });
});

describe("edit (optimistic)", () => {
  it("updates the text at once, marks it edited, then takes the server's version", async () => {
    await loadTask();
    const d = deferred();
    api.comments.update.mockReturnValueOnce(d.promise);
    const editing = store().edit("c2", "  second, corrected  ");
    expect(store().comments[1]).toMatchObject({ content: "second, corrected", edited: true });
    expect(api.comments.update).toHaveBeenCalledWith("c2", { content: "second, corrected" });

    d.resolve({ comment: makeComment("c2", "u1", "Vivek Kumar", "second, corrected", { edited: true, updatedAt: "2026-10-05T00:00:00.000Z" }) });
    await editing;
    expect(store().comments[1].updatedAt).toBe("2026-10-05T00:00:00.000Z");
    expect(toasts()).toEqual([]);
  });

  it("rolls back and toasts when refused (403), and re-checks the board", async () => {
    await loadTask();
    api.comments.update.mockRejectedValueOnce(apiError(403, "FORBIDDEN", "You can only edit your own comments"));
    const { columns, tasks, ...meta } = makeBoard();
    useBoardStore.setState({ board: meta, columns, tasks, status: "ready" });
    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    await store().edit("c2", "hijack");
    expect(store().comments[1]).toMatchObject({ content: "second", edited: false });
    expect(toasts()).toEqual(["You can only edit your own comments"]);
  });

  it("does not roll back over a newer edit", async () => {
    await loadTask();
    const slow = deferred();
    api.comments.update.mockReturnValueOnce(slow.promise);
    const older = store().edit("c2", "older");
    api.comments.update.mockResolvedValueOnce({ comment: makeComment("c2", "u1", "Vivek Kumar", "newer", { edited: true }) });
    await store().edit("c2", "newer");
    slow.reject(apiError(500, "INTERNAL_ERROR"));
    await older;
    expect(store().comments[1].content).toBe("newer");
  });

  it("ignores blank, unchanged and pending comments", async () => {
    await loadTask();
    await store().edit("c2", "  ");
    await store().edit("c2", "second");
    await store().edit("nope", "x");
    expect(api.comments.update).not.toHaveBeenCalled();

    const d = deferred();
    api.comments.create.mockReturnValueOnce(d.promise);
    const adding = store().add("t1", "pending one");
    const pendingId = store().comments[2].id;
    await store().edit(pendingId, "changed");
    expect(api.comments.update).not.toHaveBeenCalled();
    d.resolve({ comment: makeComment("c3", "u1", "Vivek Kumar", "pending one") });
    await adding;
  });
});

describe("remove (optimistic)", () => {
  it("removes at once", async () => {
    await loadTask();
    const d = deferred();
    api.comments.delete.mockReturnValueOnce(d.promise);
    const removing = store().remove("c1");
    expect(texts()).toEqual(["second"]);
    d.resolve(null);
    await removing;
    expect(api.comments.delete).toHaveBeenCalledWith("c1");
  });

  it("restores it at its original position and toasts when the server refuses", async () => {
    await loadTask();
    api.comments.delete.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await store().remove("c1");
    expect(texts()).toEqual(["first", "second"]);
    expect(toasts()).toEqual(["Something went wrong"]);
  });

  it("treats 404 as success and ignores pending comments", async () => {
    await loadTask();
    api.comments.delete.mockRejectedValueOnce(apiError(404, "COMMENT_NOT_FOUND"));
    await store().remove("c1");
    expect(texts()).toEqual(["second"]);
    expect(toasts()).toEqual([]);

    const d = deferred();
    api.comments.create.mockReturnValueOnce(d.promise);
    const adding = store().add("t1", "pending");
    await store().remove(store().comments[1].id);
    expect(api.comments.delete).toHaveBeenCalledTimes(1);
    d.resolve({ comment: makeComment("c3", "u1", "Vivek Kumar", "pending") });
    await adding;
  });
});
