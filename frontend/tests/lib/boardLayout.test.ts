import { describe, expect, it } from "vitest";
import { reconcileColumns, reconcileTasks, restoreColumnOrder, restoreTaskPlacement, sameLocation, taskLocation } from "@/lib/boardLayout";
import { makeColumn, makeTask } from "../helpers/fixtures";

const ids = (list: { id: string }[]) => list.map((x) => x.id);
const cols = new Set(["c1", "c2", "c3"]);

describe("taskLocation", () => {
  const tasks = [makeTask("a", "c1", "A", 0), makeTask("x", "c2", "X", 0), makeTask("b", "c1", "B", 1)];

  it("returns the column and the index among that column's tasks (array order)", () => {
    expect(taskLocation(tasks, "a")).toEqual({ columnId: "c1", index: 0 });
    expect(taskLocation(tasks, "b")).toEqual({ columnId: "c1", index: 1 }); // x in another column doesn't count
    expect(taskLocation(tasks, "x")).toEqual({ columnId: "c2", index: 0 });
  });

  it("returns null for an unknown task, and sameLocation compares both parts", () => {
    expect(taskLocation(tasks, "nope")).toBeNull();
    expect(sameLocation({ columnId: "c1", index: 1 }, { columnId: "c1", index: 1 })).toBe(true);
    expect(sameLocation({ columnId: "c1", index: 1 }, { columnId: "c2", index: 1 })).toBe(false);
    expect(sameLocation({ columnId: "c1", index: 1 }, { columnId: "c1", index: 0 })).toBe(false);
  });
});

describe("restoreTaskPlacement", () => {
  const snapshot = [makeTask("a", "c1", "A", 0), makeTask("b", "c1", "B", 1), makeTask("x", "c2", "X", 0)];

  it("puts a moved task back in its original column and position", () => {
    const afterDrag = [makeTask("b", "c1", "B", 1), { ...makeTask("a", "c2", "A", 0) }, makeTask("x", "c2", "X", 0)];
    const restored = restoreTaskPlacement(afterDrag, snapshot, cols);
    expect(ids(restored)).toEqual(["a", "b", "x"]);
    expect(restored.map((t) => t.columnId)).toEqual(["c1", "c1", "c2"]);
  });

  it("keeps CURRENT task data, so edits made meanwhile survive the rollback", () => {
    const current = [makeTask("b", "c1", "B", 1), makeTask("a", "c2", "A edited", 0), makeTask("x", "c2", "X", 0)];
    expect(restoreTaskPlacement(current, snapshot, cols).find((t) => t.id === "a")?.title).toBe("A edited");
  });

  it("keeps tasks the snapshot didn't know (at the end) and skips ones deleted since", () => {
    const current = [makeTask("new", "c1", "New", 2), makeTask("b", "c1", "B", 1), makeTask("a", "c2", "A", 0)]; // x was deleted
    const restored = restoreTaskPlacement(current, snapshot, cols);
    expect(ids(restored)).toEqual(["a", "b", "new"]);
  });

  it("drops tasks whose column no longer exists", () => {
    const current = [makeTask("a", "c2", "A", 0), makeTask("b", "c1", "B", 1), makeTask("x", "c2", "X", 0)];
    const restored = restoreTaskPlacement(current, snapshot, new Set(["c2"])); // c1 was deleted
    expect(ids(restored)).toEqual(["x"]);
  });

  it("does not mutate its inputs", () => {
    const current = [makeTask("a", "c2", "A", 0), makeTask("b", "c1", "B", 1)];
    const copy = JSON.stringify(current);
    restoreTaskPlacement(current, snapshot, cols);
    expect(JSON.stringify(current)).toBe(copy);
  });
});

describe("restoreColumnOrder", () => {
  it("restores the snapshot order but keeps current objects; unknown columns go last", () => {
    const snapshot = [makeColumn("c1", "A", 0), makeColumn("c2", "B", 1), makeColumn("c3", "C", 2)];
    const current = [makeColumn("c3", "C", 2), { ...makeColumn("c1", "A renamed", 0) }, makeColumn("c9", "New", 3), makeColumn("c2", "B", 1)];
    const restored = restoreColumnOrder(current, snapshot);
    expect(ids(restored)).toEqual(["c1", "c2", "c3", "c9"]);
    expect(restored[0].title).toBe("A renamed");
  });
});

describe("reconcileTasks", () => {
  const base = [makeTask("a", "c1", "A", 0), makeTask("b", "c1", "B", 1), makeTask("x", "c2", "X", 0), makeTask("z", "c3", "Z", 0)];

  it("applies the server's order and positions to the affected columns and leaves the others alone", () => {
    // locally: b moved to c2 first position, i.e. [a(c1), b(c2), x(c2), z(c3)]
    const local = [base[0], { ...base[1], columnId: "c2" }, base[2], base[3]];
    const moved = { ...makeTask("b", "c2", "B", 1), updatedAt: "2026-10-05T00:00:00.000Z" };
    const result = reconcileTasks(local, [{ columnId: "c2", taskIds: ["x", "b"] }, { columnId: "c1", taskIds: ["a"] }], moved);

    const inCol = (c: string) => result.filter((t) => t.columnId === c).map((t) => `${t.id}:${t.position}`);
    expect(inCol("c2")).toEqual(["x:0", "b:1"]); // the SERVER's order wins over the local guess
    expect(inCol("c1")).toEqual(["a:0"]);
    expect(inCol("c3")).toEqual(["z:0"]);
    expect(result.find((t) => t.id === "b")?.updatedAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("never duplicates or loses a task", () => {
    const result = reconcileTasks(base, [{ columnId: "c2", taskIds: ["x", "a"] }, { columnId: "c1", taskIds: ["b"] }], makeTask("a", "c2", "A", 1));
    expect(ids(result).sort()).toEqual(["a", "b", "x", "z"]);
  });

  it("keeps local tasks the server did not list (after the listed ones)", () => {
    const local = [...base, makeTask("late", "c2", "Created meanwhile", 1)];
    const result = reconcileTasks(local, [{ columnId: "c2", taskIds: ["x"] }], makeTask("x", "c2", "X", 0));
    expect(result.filter((t) => t.columnId === "c2").map((t) => t.id)).toEqual(["x", "late"]);
  });

  it("ignores ids it doesn't have locally", () => {
    const result = reconcileTasks(base, [{ columnId: "c1", taskIds: ["a", "ghost", "b"] }], makeTask("a", "c1", "A", 0));
    expect(result.filter((t) => t.columnId === "c1").map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("reconcileColumns", () => {
  it("takes the server's order and positions but keeps local titles (in-flight renames)", () => {
    const local = [makeColumn("c1", "Renamed locally", 0), makeColumn("c2", "B", 1), makeColumn("c3", "C", 2)];
    const server = [makeColumn("c3", "C", 0), makeColumn("c1", "Old title", 1), makeColumn("c2", "B", 2)];
    const result = reconcileColumns(local, server);
    expect(result.map((c) => `${c.id}:${c.position}`)).toEqual(["c3:0", "c1:1", "c2:2"]);
    expect(result.find((c) => c.id === "c1")?.title).toBe("Renamed locally");
  });

  it("keeps local columns the server didn't list", () => {
    const local = [makeColumn("c1", "A", 0), makeColumn("c9", "New", 1)];
    expect(ids(reconcileColumns(local, [makeColumn("c1", "A", 0)]))).toEqual(["c1", "c9"]);
  });
});
