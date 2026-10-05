import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useToastStore } from "@/store/useToastStore";
import type { Id } from "@/types";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useBoardStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const order = (columnId: Id) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.id);
const columnOrder = () => store().columns.map((c) => c.id);

/** What the drag hook does while dragging: rearrange the board locally so the task sits at `index` of `columnId`. */
function localMove(taskId: Id, columnId: Id, index: number) {
  const tasks = store().tasks;
  const moving = { ...tasks.find((t) => t.id === taskId)!, columnId };
  const rest = tasks.filter((t) => t.id !== taskId);
  const anchor = rest.filter((t) => t.columnId === columnId)[index];
  rest.splice(anchor ? rest.indexOf(anchor) : rest.length, 0, moving);
  store().setTasks(rest);
}
const localColumnMove = (from: number, to: number) => {
  const next = [...store().columns];
  next.splice(to, 0, next.splice(from, 1)[0]);
  store().setColumns(next);
};

/** Fixture: c1 = [t1,t2,t3], c2 = [t4], c3 = [] */
async function load() {
  const board = makeBoard({
    columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1), makeColumn("c3", "Done", 2)],
    tasks: [makeTask("t1", "c1", "one", 0), makeTask("t2", "c1", "two", 1), makeTask("t3", "c1", "three", 2), makeTask("t4", "c2", "four", 0)],
  });
  api.boards.get.mockResolvedValueOnce({ board });
  await store().loadBoard("b1");
}

const moveResult = (taskId: Id, columnId: Id, columns: { columnId: Id; taskIds: Id[] }[]) => ({
  task: { ...makeTask(taskId, columnId, "x", 0), updatedAt: "2026-10-05T00:00:00.000Z" },
  columns,
});

beforeEach(async () => {
  resetApiMock();
  store().reset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: null });
  await load();
});

describe("endDragTask: what gets sent", () => {
  it("moves across columns into the middle: position is the index in the destination", async () => {
    api.tasks.move.mockResolvedValueOnce(moveResult("t1", "c1", []));
    store().beginDrag();
    localMove("t3", "c2", 0); // t3 -> before t4 in Doing
    await store().endDragTask("t3");
    expect(api.tasks.move).toHaveBeenCalledWith("t3", { columnId: "c2", position: 0 });
  });

  it("reorders within a column", async () => {
    api.tasks.move.mockResolvedValueOnce(moveResult("t3", "c1", []));
    store().beginDrag();
    localMove("t3", "c1", 0);
    await store().endDragTask("t3");
    expect(order("c1")).toEqual(["t3", "t1", "t2"]);
    expect(api.tasks.move).toHaveBeenCalledWith("t3", { columnId: "c1", position: 0 });
  });

  it("moves into an empty column and to the end of a column", async () => {
    api.tasks.move.mockResolvedValue(moveResult("t1", "c3", []));
    store().beginDrag();
    localMove("t1", "c3", 0);
    await store().endDragTask("t1");
    expect(api.tasks.move).toHaveBeenLastCalledWith("t1", { columnId: "c3", position: 0 });

    store().beginDrag();
    localMove("t2", "c2", 99); // past the end -> last
    await store().endDragTask("t2");
    expect(api.tasks.move).toHaveBeenLastCalledWith("t2", { columnId: "c2", position: 1 });
  });

  it("sends nothing when the task is dropped where it started", async () => {
    store().beginDrag();
    await store().endDragTask("t2");
    store().beginDrag();
    localMove("t2", "c1", 0);
    localMove("t2", "c1", 1); // wandered off and came back
    await store().endDragTask("t2");
    expect(api.tasks.move).not.toHaveBeenCalled();
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
  });

  it("does nothing without a drag session", async () => {
    await store().endDragTask("t1");
    await store().endDragColumn();
    expect(api.tasks.move).not.toHaveBeenCalled();
    expect(api.columns.reorder).not.toHaveBeenCalled();
  });
});

describe("endDragTask: optimistic update, success and reconcile", () => {
  it("the UI is already updated before the server answers", async () => {
    const d = deferred();
    api.tasks.move.mockReturnValueOnce(d.promise);
    store().beginDrag();
    localMove("t1", "c2", 1);
    const ending = store().endDragTask("t1");
    expect(order("c2")).toEqual(["t4", "t1"]); // visible immediately
    expect(order("c1")).toEqual(["t2", "t3"]);

    d.resolve(moveResult("t1", "c2", [{ columnId: "c2", taskIds: ["t4", "t1"] }, { columnId: "c1", taskIds: ["t2", "t3"] }]));
    await ending;
    expect(toasts()).toEqual([]);
    expect(store().tasks.find((t) => t.id === "t1")).toMatchObject({ columnId: "c2", position: 1, updatedAt: "2026-10-05T00:00:00.000Z" });
    expect(store().tasks.find((t) => t.id === "t3")?.position).toBe(1); // positions follow the server
  });

  it("adopts the server's order when it differs from the local guess", async () => {
    api.tasks.move.mockResolvedValueOnce(moveResult("t1", "c2", [{ columnId: "c2", taskIds: ["t1", "t4"] }, { columnId: "c1", taskIds: ["t2", "t3"] }]));
    store().beginDrag();
    localMove("t1", "c2", 1); // we thought [t4, t1]
    await store().endDragTask("t1");
    expect(order("c2")).toEqual(["t1", "t4"]); // the server is the source of truth
  });
});

describe("endDragTask: failure", () => {
  it("rolls back to exactly where everything was and tells the user", async () => {
    api.tasks.move.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    store().beginDrag();
    localMove("t1", "c2", 0);
    await store().endDragTask("t1");

    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
    expect(order("c2")).toEqual(["t4"]);
    expect(store().tasks.find((t) => t.id === "t1")?.columnId).toBe("c1");
    expect(toasts()).toEqual(["Something went wrong"]);
    expect(api.boards.get).toHaveBeenCalledTimes(1); // only the initial load: a 500 doesn't force a resync
  });

  it("keeps unrelated changes made during the drag when rolling back", async () => {
    api.tasks.move.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR"));
    store().beginDrag();
    localMove("t1", "c2", 0);
    useBoardStore.setState((s) => ({ tasks: s.tasks.map((t) => (t.id === "t2" ? { ...t, title: "edited meanwhile" } : t)) }));
    await store().endDragTask("t1");
    expect(store().tasks.find((t) => t.id === "t2")?.title).toBe("edited meanwhile");
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
  });

  it.each([[404, "TASK_NOT_FOUND"], [409, "CONFLICT"], [403, "FORBIDDEN"]])("a %i means our view is stale: roll back, toast, and re-sync", async (status, code) => {
    api.tasks.move.mockRejectedValueOnce(apiError(status, code, `msg ${code}`));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0)], tasks: [makeTask("t2", "c1", "two", 0)] }) });
    store().beginDrag();
    localMove("t1", "c2", 0);
    await store().endDragTask("t1");
    await flush();
    expect(toasts()).toEqual([`msg ${code}`]);
    expect(api.boards.get).toHaveBeenCalledTimes(2);
    expect(store().tasks.map((t) => t.id)).toEqual(["t2"]); // converged with the server
  });

  it("a 401 ends the session instead of showing a toast", async () => {
    api.tasks.move.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    store().beginDrag();
    localMove("t1", "c2", 0);
    await store().endDragTask("t1");
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(toasts()).toEqual([]);
  });
});

describe("cancelDrag (Escape)", () => {
  it("restores the layout and sends nothing", () => {
    store().beginDrag();
    localMove("t1", "c2", 0);
    localMove("t2", "c3", 0);
    store().cancelDrag();
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
    expect(order("c2")).toEqual(["t4"]);
    expect(order("c3")).toEqual([]);
    expect(api.tasks.move).not.toHaveBeenCalled();
  });

  it("restores column order too, and a later end-of-drag does nothing", async () => {
    store().beginDrag();
    localColumnMove(0, 2);
    expect(columnOrder()).toEqual(["c2", "c3", "c1"]);
    store().cancelDrag();
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
    await store().endDragColumn();
    expect(api.columns.reorder).not.toHaveBeenCalled();
  });
});

describe("the snapshot is a deep copy", () => {
  it("is not corrupted by later changes to the objects that were in the store", async () => {
    api.tasks.move.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR"));
    const original = store().tasks.find((t) => t.id === "t1")!;
    store().beginDrag();
    original.columnId = "c2"; // simulates the old in-place mutation bug
    localMove("t1", "c2", 0);
    await store().endDragTask("t1");
    expect(store().tasks.find((t) => t.id === "t1")?.columnId).toBe("c1"); // still rolls back to the TRUE original
  });
});

describe("overlapping drags", () => {
  it("a late failure of an older move does not undo a newer move; the board re-syncs once things settle", async () => {
    const first = deferred();
    const second = deferred();
    api.tasks.move.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1), makeColumn("c3", "Done", 2)], tasks: [makeTask("t1", "c2", "one", 0), makeTask("t2", "c3", "two", 0)] }) });

    store().beginDrag();
    localMove("t1", "c2", 0);
    const endFirst = store().endDragTask("t1");
    store().beginDrag();
    localMove("t2", "c3", 0);
    const endSecond = store().endDragTask("t2");

    first.reject(apiError(500, "INTERNAL_ERROR", "first failed"));
    await endFirst;
    expect(store().tasks.find((t) => t.id === "t2")?.columnId).toBe("c3"); // newer move untouched
    expect(store().tasks.find((t) => t.id === "t1")?.columnId).toBe("c2"); // no precise rollback possible...
    expect(api.boards.get).toHaveBeenCalledTimes(1); // ...so no resync yet, the second write is still running

    second.resolve(moveResult("t2", "c3", [{ columnId: "c3", taskIds: ["t2"] }, { columnId: "c1", taskIds: ["t3"] }]));
    await endSecond;
    await flush();
    expect(toasts()).toEqual(["first failed"]);
    expect(api.boards.get).toHaveBeenCalledTimes(2); // re-synced after everything finished
    expect(store().tasks.find((t) => t.id === "t1")?.columnId).toBe("c2");
  });

  it("an older success arriving after a newer move does not reorder the board", async () => {
    const first = deferred();
    const second = deferred();
    api.tasks.move.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    store().beginDrag();
    localMove("t1", "c2", 1);
    const endFirst = store().endDragTask("t1");
    store().beginDrag();
    localMove("t3", "c3", 0);
    const endSecond = store().endDragTask("t3");
    const before = order("c2");

    first.resolve(moveResult("t1", "c2", [{ columnId: "c2", taskIds: ["t1", "t4"] }, { columnId: "c1", taskIds: ["t2", "t3"] }]));
    await endFirst;
    expect(order("c2")).toEqual(before); // stale answer ignored

    second.resolve(moveResult("t3", "c3", [{ columnId: "c3", taskIds: ["t3"] }, { columnId: "c1", taskIds: ["t2"] }]));
    await endSecond;
    expect(order("c3")).toEqual(["t3"]);
  });

  it("does not rearrange cards while the user is dragging again", async () => {
    const d = deferred();
    api.tasks.move.mockReturnValueOnce(d.promise);
    store().beginDrag();
    localMove("t1", "c2", 1);
    const ending = store().endDragTask("t1");

    store().beginDrag(); // the user grabs another card right away
    localMove("t2", "c3", 0);
    const during = order("c2");
    d.resolve(moveResult("t1", "c2", [{ columnId: "c2", taskIds: ["t1", "t4"] }, { columnId: "c1", taskIds: ["t2", "t3"] }]));
    await ending;
    expect(order("c2")).toEqual(during);
    expect(order("c3")).toEqual(["t2"]);
    store().cancelDrag();
  });

  it("ignores a response that arrives after the user left the board", async () => {
    const d = deferred();
    api.tasks.move.mockReturnValueOnce(d.promise);
    store().beginDrag();
    localMove("t1", "c2", 0);
    const ending = store().endDragTask("t1");
    store().reset();
    d.reject(apiError(500, "INTERNAL_ERROR"));
    await ending;
    expect(toasts()).toEqual([]);
    expect(store().tasks).toEqual([]);
  });
});

describe("column drag", () => {
  it("persists the new order by sending the complete id list", async () => {
    api.columns.reorder.mockResolvedValueOnce({ columns: [makeColumn("c2", "Doing", 0), makeColumn("c3", "Done", 1), makeColumn("c1", "Todo", 2)] });
    store().beginDrag();
    localColumnMove(0, 2);
    const ending = store().endDragColumn();
    expect(columnOrder()).toEqual(["c2", "c3", "c1"]); // optimistic
    await ending;
    expect(api.columns.reorder).toHaveBeenCalledWith("b1", ["c2", "c3", "c1"]);
    expect(store().columns.map((c) => c.position)).toEqual([0, 1, 2]);
  });

  it("sends nothing when the order didn't change", async () => {
    store().beginDrag();
    localColumnMove(0, 1);
    localColumnMove(1, 0);
    await store().endDragColumn();
    expect(api.columns.reorder).not.toHaveBeenCalled();
  });

  it("rolls back on failure but keeps a rename made meanwhile", async () => {
    api.columns.reorder.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    store().beginDrag();
    localColumnMove(0, 2);
    useBoardStore.setState((s) => ({ columns: s.columns.map((c) => (c.id === "c1" ? { ...c, title: "Backlog" } : c)) }));
    await store().endDragColumn();
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
    expect(store().columns[0].title).toBe("Backlog");
    expect(toasts()).toEqual(["Something went wrong"]);
  });

  it("a stale list (409) rolls back, explains, and re-syncs", async () => {
    api.columns.reorder.mockRejectedValueOnce(apiError(409, "COLUMN_LIST_OUT_OF_DATE", "The column list is out of date. Reload the board and try again."));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1), makeColumn("c3", "Done", 2), makeColumn("c4", "Added by someone", 3)], tasks: [] }) });
    store().beginDrag();
    localColumnMove(0, 2);
    await store().endDragColumn();
    await flush();
    expect(toasts()).toEqual(["The column list is out of date. Reload the board and try again."]);
    expect(columnOrder()).toEqual(["c1", "c2", "c3", "c4"]);
  });
});
