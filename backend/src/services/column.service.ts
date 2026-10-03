import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { isPrismaError } from "../utils/prismaErrors";
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
export function createColumn(boardId: string, input: CreateColumnInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const { _max } = await tx.column.aggregate({ where: { boardId }, _max: { position: true } });
    return tx.column.create({
      data: { boardId, title: input.title, position: (_max.position ?? -1) + 1 },
      select: columnSelect,
    });
  });
}

export async function renameColumn(columnId: string, input: UpdateColumnInput) {
  try {
    return await prisma.column.update({ where: { id: columnId }, data: { title: input.title }, select: columnSelect });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw columnNotFound(); // deleted after the permission check
    throw error;
  }
}

/**
 * Deletes the column (its tasks go with it via ON DELETE CASCADE, matching the existing UI) and closes the gap so
 * positions stay 0..n-1 — all in one transaction.
 */
export function deleteColumn(boardId: string, columnId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const { count } = await tx.column.deleteMany({ where: { id: columnId, boardId } });
    if (count === 0) throw columnNotFound(); // already deleted by someone else

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
