import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { isPrismaError } from "../utils/prismaErrors";
import { taskSelect, toTaskDto } from "../utils/serializers";
import type { AssignTaskInput, CreateTaskInput, MoveTaskInput, UpdateTaskInput } from "../validators/task.validator";
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

    const column = await tx.column.findFirst({ where: { id: input.columnId, boardId }, select: { id: true } });
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
    return toTaskDto(task);
  });
}

export async function updateTask(taskId: string, input: UpdateTaskInput) {
  try {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.priority !== undefined && { priority: input.priority }),
        ...(input.dueDate !== undefined && { dueDate: toDate(input.dueDate) }),
      },
      select: taskSelect,
    });
    return toTaskDto(task);
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw taskNotFound();
    throw error;
  }
}

export async function assignTask(boardId: string, taskId: string, input: AssignTaskInput) {
  if (input.assigneeId) await assertAssigneeIsMember(prisma, boardId, input.assigneeId);
  try {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { assigneeId: input.assigneeId },
      select: taskSelect,
    });
    return toTaskDto(task);
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw taskNotFound();
    throw error;
  }
}

/** Deletes the task and closes the gap it leaves in its column, atomically. */
export function deleteTask(boardId: string, taskId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const task = await tx.task.findFirst({ where: { id: taskId, boardId }, select: { columnId: true } });
    if (!task) throw taskNotFound();

    await tx.task.delete({ where: { id: taskId } });

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
export function moveTask(boardId: string, taskId: string, input: MoveTaskInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);

    const task = await tx.task.findFirst({ where: { id: taskId, boardId }, select: { id: true, columnId: true, position: true } });
    if (!task) throw taskNotFound();
    const target = await tx.column.findFirst({ where: { id: input.columnId, boardId }, select: { id: true } });
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

    const moved = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskSelect });
    return { task: toTaskDto(moved), columns: affected };
  });
}
