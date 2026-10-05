// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKanbanDnD } from "@/hooks/useKanbanDnD";
import { useBoardStore } from "@/store/useBoardStore";
import { resetApiMock } from "../helpers/apiMock";
import { makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const task = (id: string) => useBoardStore.getState().tasks.find((t) => t.id === id)!;
const evt = (active: object, over: object | null) => ({ active, over }) as unknown as DragEndEvent;
const taskItem = (id: string) => ({ id, data: { current: { type: "Task", task: task(id) } } });
const columnItem = (id: string) => ({ id, data: { current: { type: "Column" } } });

beforeEach(() => {
  resetApiMock();
  useBoardStore.getState().reset();
  const board = makeBoard({
    columns: [makeColumn("c1", "A", 0), makeColumn("c2", "B", 1), makeColumn("c3", "C", 2)],
    tasks: [makeTask("t1", "c1", "one", 0), makeTask("t2", "c1", "two", 1), makeTask("t3", "c2", "three", 0)],
  });
  const { columns, tasks, ...meta } = board;
  useBoardStore.setState({ board: meta, columns, tasks, status: "ready" });
});

describe("existing drag handler: suspected bugs", () => {
  it("onDragOver must not mutate task objects that are already in the store", () => {
    const { result } = renderHook(() => useKanbanDnD());
    const original = task("t1");
    act(() => result.current.onDragOver(evt(taskItem("t1"), taskItem("t3"))));

    expect(task("t1").columnId).toBe("c2"); // the live drag preview moved it...
    expect(original.columnId).toBe("c1"); // ...without rewriting the old object in place
  });

  it("dropping a task onto a column must not reorder the columns", () => {
    const { result } = renderHook(() => useKanbanDnD());
    act(() => result.current.onDragEnd(evt(taskItem("t1"), columnItem("c2"))));

    expect(useBoardStore.getState().columns.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });
});
