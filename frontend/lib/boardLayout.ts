import type { Column, Id, Task } from "@/types";

/**
 * Pure helpers for the board's layout (column order, and task order within each column).
 * In the client, the order of the flat `tasks` array IS the visual order inside each column.
 * Nothing here touches the store or the network, so every rule can be tested in isolation.
 */

export interface TaskLocation {
  columnId: Id;
  /** 0-based index of the task among the tasks of its column, in array order. */
  index: number;
}

export function taskLocation(tasks: Task[], taskId: Id): TaskLocation | null {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const index = tasks.filter((t) => t.columnId === task.columnId).findIndex((t) => t.id === taskId);
  return { columnId: task.columnId, index };
}

export const sameLocation = (a: TaskLocation, b: TaskLocation) => a.columnId === b.columnId && a.index === b.index;

/**
 * Undoes a drag: puts every task back in the column and relative order it had in `snapshot`, but keeps the CURRENT
 * task objects, so unrelated changes made meanwhile (an edited title, a task added or removed) are not lost.
 * Tasks the snapshot doesn't know are kept at the end; tasks whose column no longer exists are dropped.
 */
export function restoreTaskPlacement(current: Task[], snapshot: Task[], existingColumnIds: Set<Id>): Task[] {
  const snapshotById = new Map(snapshot.map((t) => [t.id, t]));
  const order = new Map(snapshot.map((t, i) => [t.id, i]));

  const placed = current
    .map((t) => {
      const before = snapshotById.get(t.id);
      return before && before.columnId !== t.columnId ? { ...t, columnId: before.columnId } : t;
    })
    .filter((t) => existingColumnIds.has(t.columnId));

  const known = placed.filter((t) => order.has(t.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const unknown = placed.filter((t) => !order.has(t.id));
  return [...known, ...unknown];
}

/** Same idea for columns: snapshot order, current objects (titles etc.), unknown columns last. */
export function restoreColumnOrder(current: Column[], snapshot: Column[]): Column[] {
  const order = new Map(snapshot.map((c, i) => [c.id, i]));
  const known = current.filter((c) => order.has(c.id)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const unknown = current.filter((c) => !order.has(c.id));
  return [...known, ...unknown];
}

export interface AffectedColumn {
  columnId: Id;
  taskIds: Id[];
}

/**
 * Applies the server's answer to a move: each affected column gets exactly the server's task order (and positions),
 * and the moved task takes the server's column/updatedAt. Other columns are left alone. Local tasks the server
 * didn't list are kept after the listed ones rather than silently discarded.
 */
export function reconcileTasks(tasks: Task[], affected: AffectedColumn[], moved: Task): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const affectedColumns = new Set(affected.map((a) => a.columnId));
  const listedIds = new Set(affected.flatMap((a) => a.taskIds));

  const untouched = tasks.filter((t) => !affectedColumns.has(t.columnId) && !listedIds.has(t.id));
  const rebuilt = affected.flatMap(({ columnId, taskIds }) => {
    const listed = taskIds.flatMap((id, index) => {
      const task = byId.get(id);
      if (!task) return [];
      return [id === moved.id ? { ...task, columnId: moved.columnId, position: index, updatedAt: moved.updatedAt } : { ...task, columnId, position: index }];
    });
    const extras = tasks.filter((t) => t.columnId === columnId && !listedIds.has(t.id));
    return [...listed, ...extras];
  });
  return [...untouched, ...rebuilt];
}

/** Applies the server's column order, keeping local objects (so an in-flight rename isn't reverted). */
export function reconcileColumns(current: Column[], server: Column[]): Column[] {
  const local = new Map(current.map((c) => [c.id, c]));
  const listed = server.flatMap((s) => {
    const column = local.get(s.id);
    return column ? [{ ...column, position: s.position }] : [];
  });
  const listedIds = new Set(server.map((s) => s.id));
  return [...listed, ...current.filter((c) => !listedIds.has(c.id))];
}
