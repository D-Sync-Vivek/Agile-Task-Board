import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useToastStore } from "@/store/useToastStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useBoardStore.getState();
const titles = (columnId: string) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.title);
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

/** Loads the default fixture board (columns Todo/Doing, tasks t1,t2 in Todo, t3 in Doing). */
async function loadFixture(board = makeBoard()) {
  api.boards.get.mockResolvedValueOnce({ board });
  await store().loadBoard(board.id);
}

beforeEach(() => {
  resetApiMock();
  useBoardStore.getState().reset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: null });
});

describe("loadBoard", () => {
  it("fills columns, tasks and board meta, and becomes ready", async () => {
    const promise = (api.boards.get.mockResolvedValueOnce({ board: makeBoard() }), store().loadBoard("b1"));
    expect(store().status).toBe("loading");
    await promise;

    expect(store().status).toBe("ready");
    expect(store().columns.map((c) => c.title)).toEqual(["Todo", "Doing"]);
    expect(store().tasks).toHaveLength(3);
    expect(store().board).toMatchObject({ id: "b1", name: "Sprint Board", myRole: "OWNER" });
    expect(store().board).not.toHaveProperty("columns"); // columns/tasks live at the top level, not duplicated in meta
  });

  it("reports a 404 as an error state with its code", async () => {
    api.boards.get.mockRejectedValueOnce(apiError(404, "BOARD_NOT_FOUND", "Board not found"));
    await store().loadBoard("nope");
    expect(store().status).toBe("error");
    expect(store().error).toEqual({ status: 404, code: "BOARD_NOT_FOUND", message: "Board not found" });
    expect(store().board).toBeNull();
  });

  it("treats a 401 as an expired session", async () => {
    api.boards.get.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await store().loadBoard("b1");
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(store().status).toBe("error");
  });

  it("ignores the result of an aborted request", async () => {
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    const controller = new AbortController();
    const load = store().loadBoard("b1", { signal: controller.signal });
    controller.abort();
    d.resolve({ board: makeBoard() });
    await load;
    expect(store().board).toBeNull();
    expect(store().status).toBe("loading"); // untouched by the cancelled request
  });

  it("lets the newest request win when an older one resolves later", async () => {
    const slow = deferred();
    api.boards.get.mockReturnValueOnce(slow.promise);
    const first = store().loadBoard("b1");
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ id: "b2", name: "Second" }) });
    await store().loadBoard("b2");

    slow.resolve({ board: makeBoard({ id: "b1", name: "First" }) });
    await first;
    expect(store().board?.name).toBe("Second");
  });

  it("clears the previous board's data when switching boards", async () => {
    await loadFixture();
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    const load = store().loadBoard("b2");
    expect(store().tasks).toEqual([]);
    expect(store().board).toBeNull();
    d.resolve({ board: makeBoard({ id: "b2", columns: [], tasks: [] }) });
    await load;
  });

  it("a silent refresh keeps showing the board while loading and survives a network failure", async () => {
    await loadFixture();
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    const refresh = store().loadBoard("b1", { silent: true });
    expect(store().status).toBe("ready"); // no loading flash
    d.reject(apiError(0, "NETWORK_ERROR", "offline"));
    await refresh;
    expect(store().status).toBe("ready");
    expect(store().tasks).toHaveLength(3);
  });

  it("a silent refresh that finds the board gone switches to the error state", async () => {
    await loadFixture();
    api.boards.get.mockRejectedValueOnce(apiError(404, "BOARD_NOT_FOUND"));
    await store().loadBoard("b1", { silent: true });
    expect(store().status).toBe("error");
  });

  it("reset() discards an in-flight load", async () => {
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    const load = store().loadBoard("b1");
    store().reset();
    d.resolve({ board: makeBoard() });
    await load;
    expect(store().board).toBeNull();
    expect(store().status).toBe("idle");
  });
});

describe("addColumn (server-confirmed)", () => {
  it("waits for the server, then appends the returned column", async () => {
    await loadFixture();
    const d = deferred();
    api.columns.create.mockReturnValueOnce(d.promise);
    const adding = store().addColumn();
    expect(store().columns).toHaveLength(2); // nothing optimistic
    expect(store().addingColumn).toBe(true);
    expect(api.columns.create).toHaveBeenCalledWith("b1", { title: "Column 3" });

    d.resolve({ column: makeColumn("c3", "Column 3", 2) });
    await adding;
    expect(store().columns.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(store().addingColumn).toBe(false);
  });

  it("ignores a second click while one request is in flight", async () => {
    await loadFixture();
    const d = deferred();
    api.columns.create.mockReturnValueOnce(d.promise);
    const first = store().addColumn();
    await store().addColumn();
    expect(api.columns.create).toHaveBeenCalledTimes(1);
    d.resolve({ column: makeColumn("c3", "Column 3", 2) });
    await first;
  });

  it("shows a toast and adds nothing on failure", async () => {
    await loadFixture();
    api.columns.create.mockRejectedValueOnce(apiError(403, "FORBIDDEN", "You do not have permission to perform this action"));
    await store().addColumn();
    expect(store().columns).toHaveLength(2);
    expect(store().addingColumn).toBe(false);
    expect(toasts()).toEqual(["You do not have permission to perform this action"]);
  });

  it("drops the result if the user moved to another board meanwhile", async () => {
    await loadFixture();
    const d = deferred();
    api.columns.create.mockReturnValueOnce(d.promise);
    const adding = store().addColumn();
    store().reset();
    d.resolve({ column: makeColumn("c3", "Column 3", 2) });
    await adding;
    expect(store().columns).toEqual([]);
  });
});

describe("addTask (server-confirmed)", () => {
  it("appends the created task and guards against double clicks per column", async () => {
    await loadFixture();
    const d = deferred();
    api.tasks.create.mockReturnValueOnce(d.promise);
    const adding = store().addTask("c2");
    void store().addTask("c2"); // same column, in flight -> ignored
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.tasks.create).toHaveBeenCalledWith("b1", { title: "Double Click to edit", columnId: "c2" });
    expect(store().addingTaskIn).toEqual(["c2"]);

    d.resolve({ task: makeTask("t9", "c2", "Double Click to edit", 1) });
    await adding;
    expect(titles("c2")).toEqual(["Review", "Double Click to edit"]);
    expect(store().addingTaskIn).toEqual([]);
  });

  it("toasts on failure and resyncs when the column no longer exists", async () => {
    await loadFixture();
    api.tasks.create.mockRejectedValueOnce(apiError(404, "COLUMN_NOT_FOUND", "Column not found"));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0)], tasks: [] }) });
    await store().addTask("c2");
    await flush();
    expect(toasts()).toEqual(["Column not found"]);
    expect(store().columns.map((c) => c.id)).toEqual(["c1"]); // refreshed from the server
  });
});

describe("renameColumn (optimistic)", () => {
  it("updates immediately, before the server answers", async () => {
    await loadFixture();
    const d = deferred();
    api.columns.rename.mockReturnValueOnce(d.promise);
    const renaming = store().renameColumn("c1", "  Backlog  ");
    expect(store().columns[0].title).toBe("Backlog"); // optimistic + trimmed
    expect(api.columns.rename).toHaveBeenCalledWith("c1", { title: "Backlog" });

    d.resolve({ column: { ...makeColumn("c1", "Backlog", 0), updatedAt: "2026-10-05T00:00:00.000Z" } });
    await renaming;
    expect(store().columns[0]).toMatchObject({ title: "Backlog", updatedAt: "2026-10-05T00:00:00.000Z" });
  });

  it("rolls back and toasts when the server rejects it", async () => {
    await loadFixture();
    api.columns.rename.mockRejectedValueOnce(apiError(403, "FORBIDDEN", "You do not have permission to perform this action"));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    await store().renameColumn("c1", "Backlog");
    expect(store().columns[0].title).toBe("Todo");
    expect(toasts()).toEqual(["You do not have permission to perform this action"]);
  });

  it("does not clobber a newer edit when an older request fails", async () => {
    await loadFixture();
    const first = deferred();
    api.columns.rename.mockReturnValueOnce(first.promise);
    const a = store().renameColumn("c1", "First");
    api.columns.rename.mockResolvedValueOnce({ column: makeColumn("c1", "Second", 0) });
    await store().renameColumn("c1", "Second");

    first.reject(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await a;
    expect(store().columns[0].title).toBe("Second"); // the newer value survives the older failure
  });

  it("ignores blank and unchanged titles without calling the API", async () => {
    await loadFixture();
    await store().renameColumn("c1", "   ");
    await store().renameColumn("c1", "Todo");
    expect(api.columns.rename).not.toHaveBeenCalled();
    expect(store().columns[0].title).toBe("Todo");
  });

  it("shows the specific validation message", async () => {
    await loadFixture();
    api.columns.rename.mockRejectedValueOnce(apiError(422, "VALIDATION_ERROR", "Invalid request data"));
    await store().renameColumn("c1", "x");
    expect(toasts()).toEqual(["Invalid request data"]); // no details supplied, so falls back to the message
    expect(store().columns[0].title).toBe("Todo");
  });
});

describe("deleteColumn (optimistic)", () => {
  it("removes the column and its tasks immediately", async () => {
    await loadFixture();
    const d = deferred();
    api.columns.delete.mockReturnValueOnce(d.promise);
    const deleting = store().deleteColumn("c1");
    expect(store().columns.map((c) => c.id)).toEqual(["c2"]);
    expect(store().tasks.map((t) => t.id)).toEqual(["t3"]);
    d.resolve(null);
    await deleting;
    expect(api.columns.delete).toHaveBeenCalledWith("c1");
    expect(toasts()).toEqual([]);
  });

  it("restores the column at its position, with its tasks in order, when the server refuses", async () => {
    await loadFixture();
    api.columns.delete.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await store().deleteColumn("c1");
    expect(store().columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(titles("c1")).toEqual(["Write tests", "Ship it"]);
    expect(titles("c2")).toEqual(["Review"]);
    expect(toasts()).toEqual(["Something went wrong"]);
  });

  it("keeps it deleted (no rollback, no toast) when the server says it is already gone", async () => {
    await loadFixture();
    api.columns.delete.mockRejectedValueOnce(apiError(404, "COLUMN_NOT_FOUND"));
    await store().deleteColumn("c1");
    expect(store().columns.map((c) => c.id)).toEqual(["c2"]);
    expect(toasts()).toEqual([]);
  });
});

describe("updateTaskTitle (optimistic)", () => {
  it("updates immediately and merges only content fields from the server", async () => {
    await loadFixture();
    const d = deferred();
    api.tasks.update.mockReturnValueOnce(d.promise);
    const saving = store().updateTaskTitle("t1", " Write more tests ");
    expect(store().tasks[0].title).toBe("Write more tests");

    // Server copy has stale placement; the local column must not be overwritten by it.
    d.resolve({ task: { ...makeTask("t1", "c9", "Write more tests", 7), updatedAt: "2026-10-05T00:00:00.000Z" } });
    await saving;
    expect(store().tasks[0]).toMatchObject({ title: "Write more tests", columnId: "c1", position: 0, updatedAt: "2026-10-05T00:00:00.000Z" });
  });

  it("rolls back on failure, and not over a newer edit", async () => {
    await loadFixture();
    api.tasks.update.mockRejectedValueOnce(apiError(422, "VALIDATION_ERROR", "Invalid request data"));
    await store().updateTaskTitle("t1", "Nope");
    expect(store().tasks[0].title).toBe("Write tests");

    const slow = deferred();
    api.tasks.update.mockReturnValueOnce(slow.promise);
    const older = store().updateTaskTitle("t1", "Older");
    api.tasks.update.mockResolvedValueOnce({ task: makeTask("t1", "c1", "Newer", 0) });
    await store().updateTaskTitle("t1", "Newer");
    slow.reject(apiError(500, "INTERNAL_ERROR"));
    await older;
    expect(store().tasks[0].title).toBe("Newer");
  });

  it("ignores blank and unchanged text", async () => {
    await loadFixture();
    await store().updateTaskTitle("t1", "   ");
    await store().updateTaskTitle("t1", "Write tests");
    expect(api.tasks.update).not.toHaveBeenCalled();
  });

  it("resyncs after a 409/404 so the UI converges with the server", async () => {
    await loadFixture();
    api.tasks.update.mockRejectedValueOnce(apiError(404, "TASK_NOT_FOUND", "Task not found"));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ tasks: [makeTask("t2", "c1", "Ship it", 0)] }) });
    await store().updateTaskTitle("t1", "Gone");
    await flush();
    expect(store().tasks.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("deleteTask (optimistic)", () => {
  it("removes immediately", async () => {
    await loadFixture();
    const d = deferred();
    api.tasks.delete.mockReturnValueOnce(d.promise);
    const deleting = store().deleteTask("t1");
    expect(store().tasks.map((t) => t.id)).toEqual(["t2", "t3"]);
    d.resolve(null);
    await deleting;
    expect(toasts()).toEqual([]);
  });

  it("puts the task back at its original position when the server refuses", async () => {
    await loadFixture();
    api.tasks.delete.mockRejectedValueOnce(apiError(403, "FORBIDDEN", "You do not have permission to perform this action"));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    await store().deleteTask("t2");
    expect(store().tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(toasts()).toEqual(["You do not have permission to perform this action"]);
  });

  it("treats 404 as success", async () => {
    await loadFixture();
    api.tasks.delete.mockRejectedValueOnce(apiError(404, "TASK_NOT_FOUND"));
    await store().deleteTask("t1");
    expect(store().tasks.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(toasts()).toEqual([]);
  });

  it("does not resurrect a task whose column disappeared in the meantime", async () => {
    await loadFixture();
    const d = deferred();
    api.tasks.delete.mockReturnValueOnce(d.promise);
    const deleting = store().deleteTask("t3");
    api.columns.delete.mockResolvedValueOnce(null);
    await store().deleteColumn("c2");
    d.reject(apiError(500, "INTERNAL_ERROR"));
    await deleting;
    expect(store().tasks.find((t) => t.id === "t3")).toBeUndefined();
  });
});

describe("401 during a write", () => {
  it("marks the session expired instead of toasting", async () => {
    await loadFixture();
    api.tasks.delete.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await store().deleteTask("t1");
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(toasts()).toEqual([]);
    expect(store().tasks.map((t) => t.id)).toEqual(["t1", "t2", "t3"]); // still rolled back
  });
});

describe("no-ops without a loaded board", () => {
  it("does nothing and never calls the API", async () => {
    await store().addColumn();
    await store().addTask("c1");
    await store().renameColumn("c1", "x");
    await store().deleteColumn("c1");
    await store().updateTaskTitle("t1", "x");
    await store().deleteTask("t1");
    for (const group of Object.values(api)) for (const fn of Object.values(group)) expect(fn).not.toHaveBeenCalled();
  });
});
