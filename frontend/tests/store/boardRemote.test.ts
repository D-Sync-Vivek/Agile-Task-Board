import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardStore } from "@/store/useBoardStore";
import type { Id } from "@/types";
import type { BoardMemberDto } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { deferred, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useBoardStore.getState();
const order = (columnId: Id) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.id);
const columnOrder = () => store().columns.map((c) => c.id);
const NOW = "2026-10-04T10:00:00.000Z";
const member = (id: string, userId: string, name: string): BoardMemberDto => ({ id, userId, role: "MEMBER", createdAt: NOW, user: { id: userId, name, email: `${userId}@x.io`, avatar: null } });

/** c1 = [t1,t2,t3], c2 = [t4], c3 = []; members: Me, Mia */
const fixture = () =>
  makeBoard({
    members: [member("m1", "u1", "Me"), member("m2", "u2", "Mia")],
    columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1), makeColumn("c3", "Done", 2)],
    tasks: [makeTask("t1", "c1", "one", 0), makeTask("t2", "c1", "two", 1), makeTask("t3", "c1", "three", 2), { ...makeTask("t4", "c2", "four", 0), assigneeId: "u2" }],
  });

async function load(board = fixture()) {
  api.boards.get.mockResolvedValueOnce({ board });
  await store().loadBoard("b1");
}

beforeEach(async () => {
  resetApiMock();
  store().reset();
  await load();
});

describe("applyRemote: tasks (board is calm)", () => {
  it("task-created appends to its column, and is idempotent", () => {
    const task = makeTask("t9", "c2", "new", 1);
    store().applyRemote({ type: "task-created", task });
    store().applyRemote({ type: "task-created", task });
    expect(order("c2")).toEqual(["t4", "t9"]);
  });

  it("task-created in a column we don't know re-reads the board", async () => {
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0), makeColumn("c9", "New", 1)], tasks: [makeTask("t9", "c9", "x", 0)] }) });
    store().applyRemote({ type: "task-created", task: makeTask("t9", "c9", "x", 0) });
    await flush();
    expect(columnOrder()).toEqual(["c1", "c9"]);
    expect(order("c9")).toEqual(["t9"]);
  });

  it("task-edited changes content but never the task's place", () => {
    store().applyRemote({ type: "task-edited", task: { ...makeTask("t2", "c3", "renamed", 0), priority: "URGENT", assigneeId: "u2", description: "d", dueDate: "2026-12-01", updatedAt: "2026-10-05T00:00:00.000Z" } });
    const t2 = store().tasks.find((t) => t.id === "t2")!;
    expect(t2).toMatchObject({ title: "renamed", priority: "URGENT", assigneeId: "u2", description: "d", dueDate: "2026-12-01", updatedAt: "2026-10-05T00:00:00.000Z", columnId: "c1" });
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
  });

  it("task-edited for a task we never saw re-reads the board", async () => {
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: fixture().columns, tasks: [...fixture().tasks, makeTask("t9", "c1", "missed", 3)] }) });
    store().applyRemote({ type: "task-edited", task: makeTask("t9", "c1", "missed", 3) });
    await flush();
    expect(order("c1")).toContain("t9");
  });

  it("task-moved applies the server's order for the affected columns", () => {
    store().applyRemote({ type: "task-moved", task: makeTask("t1", "c2", "one", 0), columns: [{ columnId: "c1", taskIds: ["t2", "t3"] }, { columnId: "c2", taskIds: ["t1", "t4"] }] });
    expect(order("c1")).toEqual(["t2", "t3"]);
    expect(order("c2")).toEqual(["t1", "t4"]);
  });

  it("task-moved for a task we had missed adds it instead of losing it", () => {
    store().applyRemote({ type: "task-moved", task: makeTask("t9", "c3", "late", 0), columns: [{ columnId: "c3", taskIds: ["t9"] }] });
    expect(order("c3")).toEqual(["t9"]);
  });

  it("task-moved is idempotent", () => {
    const change = { type: "task-moved" as const, task: makeTask("t1", "c2", "one", 0), columns: [{ columnId: "c1", taskIds: ["t2", "t3"] }, { columnId: "c2", taskIds: ["t1", "t4"] }] };
    store().applyRemote(change);
    store().applyRemote(change);
    expect(order("c2")).toEqual(["t1", "t4"]);
    expect(store().tasks).toHaveLength(4);
  });

  it("task-deleted removes it (and twice is fine)", () => {
    store().applyRemote({ type: "task-deleted", taskId: "t2" });
    store().applyRemote({ type: "task-deleted", taskId: "t2" });
    expect(order("c1")).toEqual(["t1", "t3"]);
  });
});

describe("applyRemote: columns, board, members", () => {
  it("column-created appends once; column-renamed updates the title", () => {
    const column = makeColumn("c4", "Review", 3);
    store().applyRemote({ type: "column-created", column });
    store().applyRemote({ type: "column-created", column });
    store().applyRemote({ type: "column-renamed", column: { ...column, title: "In Review" } });
    expect(columnOrder()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(store().columns[3].title).toBe("In Review");
  });

  it("column-deleted removes the column and its tasks", () => {
    store().applyRemote({ type: "column-deleted", columnId: "c1" });
    expect(columnOrder()).toEqual(["c2", "c3"]);
    expect(store().tasks.map((t) => t.id)).toEqual(["t4"]);
  });

  it("columns-reordered applies the order; a column we don't know re-reads the board", async () => {
    store().applyRemote({ type: "columns-reordered", columns: [makeColumn("c3", "Done", 0), makeColumn("c1", "Todo", 1), makeColumn("c2", "Doing", 2)] });
    expect(columnOrder()).toEqual(["c3", "c1", "c2"]);

    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c9", "X", 0), ...fixture().columns], tasks: [] }) });
    store().applyRemote({ type: "columns-reordered", columns: [makeColumn("c9", "X", 0), makeColumn("c3", "Done", 1)] });
    await flush();
    expect(columnOrder()).toContain("c9");
  });

  it("board-edited renames the board", () => {
    store().applyRemote({ type: "board-edited", name: "Renamed", description: "now with words" });
    expect(store().board).toMatchObject({ name: "Renamed", description: "now with words" });
  });

  it("members: added once, role changed, removed (their tasks become unassigned)", () => {
    const rahul = member("m3", "u3", "Rahul");
    store().applyRemote({ type: "member-added", member: rahul });
    store().applyRemote({ type: "member-added", member: rahul });
    expect(store().board!.members.map((m) => m.user.name)).toEqual(["Me", "Mia", "Rahul"]);

    store().applyRemote({ type: "member-changed", member: { ...rahul, role: "ADMIN" } });
    expect(store().board!.members[2].role).toBe("ADMIN");

    store().applyRemote({ type: "member-removed", userId: "u2", memberId: "m2" });
    expect(store().board!.members.map((m) => m.user.name)).toEqual(["Me", "Rahul"]);
    expect(store().tasks.find((t) => t.id === "t4")!.assigneeId).toBeNull();
  });

  it("does nothing when no board is open", () => {
    store().reset();
    expect(() => store().applyRemote({ type: "task-deleted", taskId: "t1" })).not.toThrow();
    expect(store().tasks).toEqual([]);
  });
});

describe("applyRemote while THIS user is dragging", () => {
  /** What the drag hook does: rearrange locally for live feedback. */
  const dragT1To = (columnId: Id) => store().setTasks(store().tasks.map((t) => (t.id === "t1" ? { ...t, columnId } : t)));

  it("does not touch the board mid-drag: the dragged card stays under the cursor", () => {
    store().beginDrag();
    dragT1To("c3");
    const before = store().tasks;

    store().applyRemote({ type: "task-created", task: makeTask("t9", "c1", "new", 3) });
    store().applyRemote({ type: "task-deleted", taskId: "t2" });
    store().applyRemote({ type: "task-moved", task: makeTask("t3", "c2", "three", 0), columns: [{ columnId: "c1", taskIds: ["t1", "t2"] }, { columnId: "c2", taskIds: ["t3", "t4"] }] });
    store().applyRemote({ type: "column-deleted", columnId: "c2" });
    store().applyRemote({ type: "columns-reordered", columns: [makeColumn("c3", "Done", 0), makeColumn("c1", "Todo", 1), makeColumn("c2", "Doing", 2)] });
    store().applyRemote({ type: "column-created", column: makeColumn("c4", "New", 3) });

    expect(store().tasks).toBe(before); // identical object: nothing was applied
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
  });

  it("content-only changes still apply mid-drag (they can't move anything)", () => {
    store().beginDrag();
    dragT1To("c3");
    store().applyRemote({ type: "task-edited", task: { ...makeTask("t2", "c1", "two!", 1), priority: "HIGH" } });
    store().applyRemote({ type: "column-renamed", column: { ...makeColumn("c1", "Backlog", 0) } });
    expect(store().tasks.find((t) => t.id === "t2")).toMatchObject({ title: "two!", priority: "HIGH" });
    expect(store().columns[0].title).toBe("Backlog");
    expect(order("c3")).toEqual(["t1"]); // the drag preview is intact
  });

  it("re-reads the board once the drag is over, so nothing the others did is lost", async () => {
    store().beginDrag();
    dragT1To("c3");
    store().applyRemote({ type: "task-created", task: makeTask("t9", "c1", "created meanwhile", 3) });

    api.tasks.move.mockResolvedValue({ task: makeTask("t1", "c3", "one", 0), columns: [{ columnId: "c1", taskIds: ["t2", "t3", "t9"] }, { columnId: "c3", taskIds: ["t1"] }] });
    api.boards.get.mockResolvedValueOnce({
      board: makeBoard({ columns: fixture().columns, tasks: [makeTask("t2", "c1", "two", 0), makeTask("t3", "c1", "three", 1), makeTask("t9", "c1", "created meanwhile", 2), makeTask("t1", "c3", "one", 0), makeTask("t4", "c2", "four", 0)] }),
    });
    await store().endDragTask("t1");
    await flush();

    expect(order("c1")).toEqual(["t2", "t3", "t9"]);
    expect(order("c3")).toEqual(["t1"]);
  });

  it("a cancelled drag also catches up", async () => {
    store().beginDrag();
    store().applyRemote({ type: "task-deleted", taskId: "t3" });
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: fixture().columns, tasks: [makeTask("t1", "c1", "one", 0), makeTask("t2", "c1", "two", 1), makeTask("t4", "c2", "four", 0)] }) });
    store().cancelDrag();
    await flush();
    expect(order("c1")).toEqual(["t1", "t2"]);
  });
});

describe("applyRemote while a move of THIS user is still being saved", () => {
  it("waits for the save, then catches up (the optimistic update isn't fought)", async () => {
    const pending = deferred<{ task: ReturnType<typeof makeTask>; columns: { columnId: string; taskIds: string[] }[] }>();
    api.tasks.move.mockReturnValue(pending.promise);

    store().beginDrag();
    store().setTasks(store().tasks.map((t) => (t.id === "t1" ? { ...t, columnId: "c3" } : t)));
    const saving = store().endDragTask("t1"); // request in flight, UI already moved

    store().applyRemote({ type: "task-deleted", taskId: "t2" });
    expect(order("c1")).toEqual(["t2", "t3"]); // not applied yet

    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: fixture().columns, tasks: [makeTask("t3", "c1", "three", 0), makeTask("t1", "c3", "one", 0), makeTask("t4", "c2", "four", 0)] }) });
    pending.resolve({ task: makeTask("t1", "c3", "one", 0), columns: [{ columnId: "c1", taskIds: ["t2", "t3"] }, { columnId: "c3", taskIds: ["t1"] }] });
    await saving;
    await flush();
    expect(order("c1")).toEqual(["t3"]);
    expect(order("c3")).toEqual(["t1"]);
  });
});
