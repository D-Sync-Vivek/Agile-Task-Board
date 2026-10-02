import { prisma } from "../config/prisma";
import { roleHasPermission } from "../config/permissions";
import type { Permission } from "../config/permissions";
import type { BoardRole } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";

export interface BoardMembership {
  boardId: string;
  role: BoardRole;
}

/**
 * The user's role on a board, or null if they aren't a member (or the board doesn't exist).
 * BoardMember is the single source of truth for access; the board service keeps the owner's OWNER row in place.
 * Always read from the database (no caching) so role changes and removals apply on the very next request.
 * Also reusable outside HTTP, e.g. when authorising a Socket.IO room join.
 */
export async function getBoardMembership(userId: string, boardId: string): Promise<BoardMembership | null> {
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { boardId: true, role: true },
  });
  return membership;
}

/**
 * Throws unless `userId` is a member of the board with a role that grants `permission`.
 *  - not a member / no such board -> 404 BOARD_NOT_FOUND (identical, so board IDs can't be probed)
 *  - member without the permission -> 403 FORBIDDEN
 */
export async function assertBoardPermission(
  userId: string,
  boardId: string,
  permission: Permission
): Promise<BoardMembership> {
  const membership = await getBoardMembership(userId, boardId);
  if (!membership) {
    throw new AppError(404, "BOARD_NOT_FOUND", "Board not found");
  }
  if (!roleHasPermission(membership.role, permission)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
  }
  return membership;
}
