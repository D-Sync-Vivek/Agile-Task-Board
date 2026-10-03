import type { Prisma } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";

export type Tx = Prisma.TransactionClient;

/**
 * Serialises every order-changing mutation on one board (column create/delete/reorder, task create/move/delete).
 * Positions are a dense 0..n-1 sequence that is rewritten as a whole, so two concurrent writers could otherwise read
 * the same state and write duplicate or gapped positions. A row lock on the board makes them take turns; it is
 * released automatically when the surrounding transaction commits or rolls back. Must be called inside a transaction.
 */
export async function lockBoard(tx: Tx, boardId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM boards WHERE id = ${boardId} FOR UPDATE`;
  if (rows.length === 0) throw new AppError(404, "BOARD_NOT_FOUND", "Board not found");
}
