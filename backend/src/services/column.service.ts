import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { recordActivity } from "./activity.service";
import { lockBoard } from "./boardLock";
import type { Tx } from "./boardLock";
import type { CreateColumnInput, UpdateColumnInput } from "../validators/column.validator";

export const columnNotFound = () => new AppError(404, "COLUMN_NOT_FOUND", "Column not found");

const columnSelect = { id: true, boardId: true, title: true, position: true, createdAt: true, updatedAt: true } as const;

/** For requireBoardPermission: which board owns this column? undefined if there is no such column. */
export async function resolveColumnBoardId(columnId: string): Promise<string | undefined> {
  const column = await prisma.column.findUnique({ where: { id: columnId }, select: { boardId: true } });
  return column?.boardId;
}

/** Rewrites positions to 0..n-1 in the given id order, touching only rows whose position actually changes. */
async function writePositions(tx: Tx, current: { id: string; position: number }[], orderedIds: string[]) {
  const positionById = new Map(current.map((c) => [c.id, c.position]));
  for (let index = 0; index < orderedIds.length; index++) {
    const id = orderedIds[index];
    if (positionById.get(id) !== index) {
      await tx.column.update({ where: { id }, data: { position: index } });
    }
  }
}

/** New columns are appended at the end. */
export function createColumn(boardId: string, userId: string, input: CreateColumnInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const { _max } = await tx.column.aggregate({ where: { boardId }, _max: { position: true } });
    const column = await tx.column.create({
      data: { boardId, title: input.title, position: (_max.position ?? -1) + 1 },
      select: columnSelect,
    });
    await recordActivity(tx, { boardId, userId, action: "COLUMN_CREATED", entityId: column.id, metadata: { columnTitle: column.title } });
    return column;
  });
}

/** Renames the column; a rename to the same title is not recorded. */
export function renameColumn(boardId: string, columnId: string, userId: string, input: UpdateColumnInput) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.column.findFirst({ where: { id: columnId, boardId }, select: { title: true } });
    if (!before) throw columnNotFound(); // deleted after the permission check

    const column = await tx.column.update({ where: { id: columnId }, data: { title: input.title }, select: columnSelect });
    if (before.title !== column.title) {
      await recordActivity(tx, { boardId, userId, action: "COLUMN_RENAMED", entityId: columnId, metadata: { from: before.title, to: column.title } });
    }
    return column;
  });
}

/**
 * Deletes the column (its tasks go with it via ON DELETE CASCADE, matching the existing UI) and closes the gap so
 * positions stay 0..n-1 — all in one transaction.
 */
export function deleteColumn(boardId: string, columnId: string, userId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    // Snapshot first: after the delete, neither the title nor the number of tasks that went with it can be read.
    const column = await tx.column.findFirst({ where: { id: columnId, boardId }, select: { title: true, _count: { select: { tasks: true } } } });
    if (!column) throw columnNotFound(); // already deleted by someone else
    await tx.column.delete({ where: { id: columnId } });
    await recordActivity(tx, {
      boardId,
      userId,
      action: "COLUMN_DELETED",
      entityId: columnId,
      metadata: { columnTitle: column.title, taskCount: column._count.tasks },
    });

    const remaining = await tx.column.findMany({
      where: { boardId },
      select: { id: true, position: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    await writePositions(
      tx,
      remaining,
      remaining.map((c) => c.id)
    );
  });
}

/**
 * Persists a new column order. The client sends the full list of ids; if it doesn't match the board's current
 * columns exactly (someone added/removed one meanwhile, or ids from elsewhere), nothing is written and the client
 * gets 409 so it can reload instead of silently overwriting someone else's change.
 */
export function reorderColumns(boardId: string, orderedIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const current = await tx.column.findMany({ where: { boardId }, select: { id: true, position: true } });

    const currentIds = new Set(current.map((c) => c.id));
    const matches = orderedIds.length === current.length && orderedIds.every((id) => currentIds.has(id));
    if (!matches) {
      throw new AppError(409, "COLUMN_LIST_OUT_OF_DATE", "The column list is out of date. Reload the board and try again.");
    }

    await writePositions(tx, current, orderedIds);
    return tx.column.findMany({ where: { boardId }, select: columnSelect, orderBy: { position: "asc" } });
  });
}
