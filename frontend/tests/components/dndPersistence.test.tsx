// @vitest-environment jsdom
// Drives the real useKanbanDnD hook with dnd-kit-shaped events through complete gestures.
// (jsdom has no layout, so real pointer/keyboard dragging can't be simulated; that needs a browser.)
import { act, renderHook } from "@testing-library/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKanbanDnD } from "@/hooks/useKanbanDnD";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useToastStore } from "@/store/useToastStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useBoardStore.getState();
const task = (id: string) => store().tasks.find((t) => t.id === id)!;
const order = (columnId: string) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.id);
const columnOrder = () => store().columns.map((c) => c.id);
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

const taskItem = (id: string) => ({ id, data: { current: { type: "Task", task: task(id) } } });
const columnItem = (id: string) => ({ id, data: { current: { type: "Column", column: store().columns.find((c) => c.id === id) } } });
const start = (active: object) => ({ active }) as unknown as DragStartEvent;
const evt = (active: object, over: object | null) => ({ active, over }) as unknown as DragEndEvent;

/** Fixture: Todo=[t1,t2,t3]  Doing=[t4]  Done=[] */
beforeEach(() => {
  resetApiMock();
  store().reset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: null });
  const { columns, tasks, ...meta } = makeBoard({
    columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1), makeColumn("c3", "Done", 2)],
    tasks: [makeTask("t1", "c1", "one", 0), makeTask("t2", "c1", "two", 1), makeTask("t3", "c1", "three", 2), makeTask("t4", "c2", "four", 0)],
  });
  useBoardStore.setState({ board: meta, columns, tasks, status: "ready" });
});

const ok = (taskId: string, columnId: string, columns: { columnId: string; taskIds: string[] }[]) => ({
  task: { ...makeTask(taskId, columnId, "x", 0), updatedAt: "2026-10-05T00:00:00.000Z" },
  columns,
});

async function settle() {
  await act(async () => {
    await flush();
  });
}

describe("dragging a task", () => {
  it("across columns: live preview, then ONE request with the final column and position", async () => {
    api.tasks.move.mockResolvedValueOnce(ok("t1", "c2", []));
    const { result } = renderHook(() => useKanbanDnD());

    act(() => result.current.onDragStart(start(taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t4")))); // hover over the card in Doing
    expect(task("t1").columnId).toBe("c2"); // preview only; nothing sent yet
    expect(api.tasks.move).not.toHaveBeenCalled();

    act(() => result.current.onDragEnd(evt(taskItem("t1"), taskItem("t1")))); // dropped: "over" is itself
    await settle();
    expect(api.tasks.move).toHaveBeenCalledTimes(1);
    expect(api.tasks.move).toHaveBeenCalledWith("t1", { columnId: "c2", position: order("c2").indexOf("t1") });
    expect(toasts()).toEqual([]);
  });

  it("onto an empty column", async () => {
    api.tasks.move.mockResolvedValueOnce(ok("t2", "c3", []));
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t2"))));
    act(() => result.current.onDragOver(evt(taskItem("t2"), columnItem("c3"))));
    act(() => result.current.onDragEnd(evt(taskItem("t2"), columnItem("c3"))));
    await settle();
    expect(api.tasks.move).toHaveBeenCalledWith("t2", { columnId: "c3", position: 0 });
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]); // the column was NOT reordered by the drop (old bug)
  });

  it("reordering inside one column", async () => {
    api.tasks.move.mockResolvedValueOnce(ok("t3", "c1", []));
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t3"))));
    act(() => result.current.onDragOver(evt(taskItem("t3"), taskItem("t1"))));
    act(() => result.current.onDragEnd(evt(taskItem("t3"), taskItem("t1"))));
    await settle();
    expect(order("c1")).toEqual(["t3", "t1", "t2"]);
    expect(api.tasks.move).toHaveBeenCalledWith("t3", { columnId: "c1", position: 0 });
  });

  it("dropped outside any target: the card stays where the preview left it, and that is saved", async () => {
    api.tasks.move.mockResolvedValueOnce(ok("t1", "c2", []));
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t4"))));
    act(() => result.current.onDragEnd(evt(taskItem("t1"), null)));
    await settle();
    expect(api.tasks.move).toHaveBeenCalledWith("t1", { columnId: "c2", position: order("c2").indexOf("t1") });
  });

  it("dropped back where it started: no request", async () => {
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t2"))));
    act(() => result.current.onDragEnd(evt(taskItem("t2"), taskItem("t2"))));
    await settle();
    expect(api.tasks.move).not.toHaveBeenCalled();
  });

  it("Escape: everything snaps back and nothing is sent", async () => {
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t4"))));
    expect(task("t1").columnId).toBe("c2");
    act(() => result.current.onDragCancel());
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
    expect(order("c2")).toEqual(["t4"]);
    expect(result.current.activeTask).toBeNull();
    await settle();
    expect(api.tasks.move).not.toHaveBeenCalled();
  });

  it("a rejected move rolls the card back visually and shows a toast", async () => {
    const d = deferred();
    api.tasks.move.mockReturnValueOnce(d.promise);
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t4"))));
    act(() => result.current.onDragEnd(evt(taskItem("t1"), taskItem("t1"))));
    expect(task("t1").columnId).toBe("c2"); // stays put while the request is in flight (no waiting for the server)

    d.reject(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await settle();
    expect(order("c1")).toEqual(["t1", "t2", "t3"]);
    expect(order("c2")).toEqual(["t4"]);
    expect(toasts()).toEqual(["Something went wrong"]);
  });

  it("the overlay card tracks the dragged task, and clears afterwards", () => {
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(taskItem("t1"))));
    expect(result.current.activeTask?.id).toBe("t1");
    expect(result.current.activeColumn).toBeNull();
    act(() => result.current.onDragEnd(evt(taskItem("t1"), taskItem("t1"))));
    expect(result.current.activeTask).toBeNull();
  });
});

describe("dragging a column", () => {
  it("over another column: reorders and sends the complete id list", async () => {
    api.columns.reorder.mockResolvedValueOnce({ columns: [makeColumn("c2", "Doing", 0), makeColumn("c3", "Done", 1), makeColumn("c1", "Todo", 2)] });
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(columnItem("c1"))));
    expect(result.current.activeColumn?.id).toBe("c1");
    act(() => result.current.onDragEnd(evt(columnItem("c1"), columnItem("c3"))));
    expect(columnOrder()).toEqual(["c2", "c3", "c1"]);
    await settle();
    expect(api.columns.reorder).toHaveBeenCalledWith("b1", ["c2", "c3", "c1"]);
    expect(api.tasks.move).not.toHaveBeenCalled();
  });

  it("released over a task inside a column: lands at that column's position (it used to jump to the end)", async () => {
    api.columns.reorder.mockResolvedValueOnce({ columns: [] });
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(columnItem("c3"))));
    act(() => result.current.onDragEnd(evt(columnItem("c3"), taskItem("t4")))); // t4 lives in c2 (index 1)
    expect(columnOrder()).toEqual(["c1", "c3", "c2"]);
    await settle();
    expect(api.columns.reorder).toHaveBeenCalledWith("b1", ["c1", "c3", "c2"]);
  });

  it("dropped on itself, outside, or over something unknown: no change and no request", async () => {
    const { result } = renderHook(() => useKanbanDnD());
    for (const over of [columnItem("c1"), null, { id: "mystery", data: { current: { type: "Task" } } }]) {
      act(() => result.current.onDragStart(start(columnItem("c1"))));
      act(() => result.current.onDragEnd(evt(columnItem("c1"), over)));
    }
    await settle();
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
    expect(api.columns.reorder).not.toHaveBeenCalled();
  });

  it("Escape restores the column order", () => {
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(columnItem("c1"))));
    act(() => store().setColumns([store().columns[1], store().columns[2], store().columns[0]]));
    act(() => result.current.onDragCancel());
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
    expect(result.current.activeColumn).toBeNull();
  });

  it("a rejected reorder rolls the columns back with a toast", async () => {
    api.columns.reorder.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragStart(start(columnItem("c1"))));
    act(() => result.current.onDragEnd(evt(columnItem("c1"), columnItem("c2"))));
    await settle();
    expect(columnOrder()).toEqual(["c1", "c2", "c3"]);
    expect(toasts()).toEqual(["Something went wrong"]);
  });
});

describe("live preview (onDragOver) is non-destructive", () => {
  it("never edits task objects in place, so the rollback snapshot stays valid", () => {
    const { result } = renderHook(() => useKanbanDnD());
    const original = task("t1");
    act(() => result.current.onDragStart(start(taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t4"))));
    expect(task("t1").columnId).toBe("c2");
    expect(original.columnId).toBe("c1");
    act(() => result.current.onDragOver(evt(taskItem("t1"), columnItem("c3"))));
    expect(original.columnId).toBe("c1");
    expect(task("t1").columnId).toBe("c3");
  });

  it("ignores hovering over itself or nothing", () => {
    const { result } = renderHook(() => useKanbanDnD());
    const before = store().tasks;
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t1"))));
    act(() => result.current.onDragOver(evt(taskItem("t1"), null)));
    expect(store().tasks).toBe(before);
  });
});
