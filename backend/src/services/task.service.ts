import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { taskSelect, toTaskDto } from "../utils/serializers";
import type { AssignTaskInput, CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "../validators/task.validator";
import { recordActivity } from "./activity.service";
import type { TaskFieldChanges } from "./activity.service";
import { lockBoard } from "./boardLock";
import type { Tx } from "./boardLock";
import { columnNotFound } from "./column.service";

export const taskNotFound = () => new AppError(404, "TASK_NOT_FOUND", "Task not found");

// "YYYY-MM-DD" -> Date at UTC midnight (stored in a DATE column, so no time zone drift).
const toDate = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00.000Z`) : value);

const userSummarySelect = { id: true, name: true, avatar: true } as const;
const byPosition = [{ position: "asc" as const }, { createdAt: "asc" as const }];

/** For requireBoardPermission: which board owns this task? undefined if there is no such task. */
export async function resolveTaskBoardId(taskId: string): Promise<string | undefined> {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { boardId: true } });
  return task?.boardId;
}

/** Assignees must belong to the board (any role). Same error whether the user doesn't exist or just isn't a member. */
async function assertAssigneeIsMember(db: Pick<Tx, "boardMember">, boardId: string, userId: string) {
  const membership = await db.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { id: true },
  });
  if (!membership) {
    throw new AppError(422, "INVALID_ASSIGNEE", "Assignee must be a member of this board");
  }
}

/** Rewrites a column's tasks to positions 0..n-1 in `orderedIds` order; only rows that actually change are updated. */
async function writePositions(
  tx: Tx,
  columnId: string,
  orderedIds: string[],
  current: Map<string, { position: number; columnId: string }>
) {
  for (let index = 0; index < orderedIds.length; index++) {
    const id = orderedIds[index];
    const row = current.get(id);
    if (!row || row.position !== index || row.columnId !== columnId) {
      await tx.task.update({ where: { id }, data: { columnId, position: index } });
    }
  }
}

export async function listTasks(boardId: string) {
  const tasks = await prisma.task.findMany({ where: { boardId }, select: taskSelect, orderBy: byPosition });
  return tasks.map(toTaskDto);
}

export async function getTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { ...taskSelect, createdBy: { select: userSummarySelect }, assignee: { select: userSummarySelect } },
  });
  if (!task) throw taskNotFound();
  return toTaskDto(task);
}

/** Appends the task at the end of its column. */
export function createTask(boardId: string, userId: string, input: CreateTaskInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);

    const column = await tx.column.findFirst({ where: { id: input.columnId, boardId }, select: { id: true, title: true } });
    if (!column) throw columnNotFound(); // missing or belongs to another board: same answer
    if (input.assigneeId) await assertAssigneeIsMember(tx, boardId, input.assigneeId);

    const { _max } = await tx.task.aggregate({ where: { columnId: column.id }, _max: { position: true } });
    const task = await tx.task.create({
      data: {
        boardId,
        columnId: column.id,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        dueDate: toDate(input.dueDate) ?? null,
        createdById: userId,
        position: (_max.position ?? -1) + 1,
      },
      select: taskSelect,
    });
    await recordActivity(tx, {
      boardId,
      userId,
      action: "TASK_CREATED",
      entityId: task.id,
      metadata: { taskTitle: task.title, columnTitle: column.title },
    });
    return toTaskDto(task);
  });
}

/** Updates the task's own fields. Records ONE activity entry listing what actually changed (nothing if nothing did). */
export function updateTask(boardId: string, taskId: string, userId: string, input: UpdateTaskInput) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.task.findFirst({ where: { id: taskId, boardId }, select: taskSelect });
    if (!before) throw taskNotFound();

    const task = await tx.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.dueDate !== undefined && { dueDate: toDate(input.dueDate) }),
      },
      select: taskSelect,
    });

    const changes: TaskFieldChanges = {};
    if (task.title !== before.title) changes.title = { from: before.title, to: task.title };
    if (task.priority !== before.priority) changes.priority = { from: before.priority, to: task.priority };
    if (task.description !== before.description) changes.description = true;
    const dueBefore = toTaskDto(before).dueDate;
    const dueAfter = toTaskDto(task).dueDate;
    if (dueAfter !== dueBefore) changes.dueDate = { from: dueBefore, to: dueAfter };

    if (Object.keys(changes).length > 0) {
      await recordActivity(tx, { boardId, userId, action: "TASK_UPDATED", entityId: taskId, metadata: { taskTitle: task.title, changes } });
    }
    return toTaskDto(task);
  });
}

/** Assigns (or, with assigneeId null, unassigns). Records who it was assigned from/to; unchanged assignee = no entry. */
export function assignTask(boardId: string, taskId: string, userId: string, input: AssignTaskInput) {
  return prisma.$transaction(async (tx) => {
    if (input.assigneeId) await assertAssigneeIsMember(tx, boardId, input.assigneeId);

    const before = await tx.task.findFirst({
      where: { id: taskId, boardId },
      select: { assigneeId: true, assignee: { select: { id: true, name: true } } },
    });
    if (!before) throw taskNotFound();

    const task = await tx.task.update({
      where: { id: taskId },
      data: { assigneeId: input.assigneeId },
      select: taskSelect,
    });

    if (before.assigneeId !== task.assigneeId) {
      const to = task.assigneeId ? await tx.user.findUnique({ where: { id: task.assigneeId }, select: { id: true, name: true } }) : null;
      await recordActivity(tx, {
        boardId,
        userId,
        action: "TASK_ASSIGNED",
        entityId: taskId,
        metadata: { taskTitle: task.title, from: before.assignee, to },
      });
    }
    return toTaskDto(task);
  });
}

/** Deletes the task and closes the gap it leaves in its column, atomically. */
export function deleteTask(boardId: string, taskId: string, userId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const task = await tx.task.findFirst({ where: { id: taskId, boardId }, select: { columnId: true, title: true, column: { select: { title: true } } } });
    if (!task) throw taskNotFound();

    await tx.task.delete({ where: { id: taskId } });
    await recordActivity(tx, {
      boardId,
      userId,
      action: "TASK_DELETED",
      entityId: taskId,
      metadata: { taskTitle: task.title, columnTitle: task.column.title },
    });

    const remaining = await tx.task.findMany({ where: { columnId: task.columnId }, select: { id: true, position: true, columnId: true }, orderBy: byPosition });
    await writePositions(tx, task.columnId, remaining.map((t) => t.id), new Map(remaining.map((t) => [t.id, t])));
  });
}

/**
 * Moves a task to `position` (0-based) in `columnId` — the same column (reorder) or another one — and keeps BOTH
 * columns' positions dense (0..n-1), in one transaction under the board lock.
 * A position past the end means "last". Returns the moved task plus the new task order of every affected column
 * (what the frontend and, later, real-time subscribers need to reconcile).
 */
export function moveTask(boardId: string, taskId: string, userId: string, input: MoveTaskInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);

    const task = await tx.task.findFirst({ where: { id: taskId, boardId }, select: { id: true, title: true, columnId: true, position: true, column: { select: { id: true, title: true } } } });
    if (!task) throw taskNotFound();
    const target = await tx.column.findFirst({ where: { id: input.columnId, boardId }, select: { id: true, title: true } });
    if (!target) throw columnNotFound();

    const sourceColumnId = task.columnId;
    const targetColumnId = target.id;

    // Target column's tasks without the moving one, with the moving one inserted at the (clamped) index.
    const others = await tx.task.findMany({
      where: { columnId: targetColumnId, id: { not: taskId } },
      select: { id: true, position: true, columnId: true },
      orderBy: byPosition,
    });
    const current = new Map(others.map((t) => [t.id, t]));
    current.set(task.id, { id: task.id, position: task.position, columnId: sourceColumnId });
    const targetIds = others.map((t) => t.id);
    targetIds.splice(Math.min(input.position, targetIds.length), 0, task.id);
    await writePositions(tx, targetColumnId, targetIds, current);

    const affected = [{ columnId: targetColumnId, taskIds: targetIds }];

    if (sourceColumnId !== targetColumnId) {
      const left = await tx.task.findMany({
        where: { columnId: sourceColumnId },
        select: { id: true, position: true, columnId: true },
        orderBy: byPosition,
      });
      const leftIds = left.map((t) => t.id);
      await writePositions(tx, sourceColumnId, leftIds, new Map(left.map((t) => [t.id, t])));
      affected.push({ columnId: sourceColumnId, taskIds: leftIds });
    }

    // Only moves BETWEEN columns are history ("Todo → Done"); reordering inside a column is just housekeeping.
    if (sourceColumnId !== targetColumnId) {
      await recordActivity(tx, {
        boardId,
        userId,
        action: "TASK_MOVED",
        entityId: taskId,
        metadata: { taskTitle: task.title, fromColumn: task.column, toColumn: { id: target.id, title: target.title } },
      });
    }

    const moved = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskSelect });
    return { task: toTaskDto(moved), columns: affected };
  });
}
