import { prisma } from "../config/prisma";
import type { BoardRole } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";
import { isPrismaError } from "../utils/prismaErrors";
import { taskSelect, toTaskDto } from "../utils/serializers";
import type { CreateBoardInput, UpdateBoardInput } from "../validators/board.validator";

const boardNotFound = () => new AppError(404, "BOARD_NOT_FOUND", "Board not found");

const summarySelect = {
  id: true,
  name: true,
  description: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true, tasks: true } },
} as const;

interface BoardSummaryRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number; tasks: number };
}

/** Dashboard card: board info + the caller's role + counts. */
function toBoardSummary(board: BoardSummaryRow, myRole: BoardRole) {
  const { _count, ...rest } = board;
  return { ...rest, myRole, memberCount: _count.members, taskCount: _count.tasks };
}

/** Boards the user belongs to (any role), most recently updated first. One query, counts computed in SQL. */
export async function listBoards(userId: string) {
  const memberships = await prisma.boardMember.findMany({
    where: { userId },
    select: { role: true, board: { select: summarySelect } },
    orderBy: { board: { updatedAt: "desc" } },
  });
  return memberships.map((m) => toBoardSummary(m.board, m.role));
}

/**
 * Creates the board and the creator's OWNER membership in ONE nested write, which Prisma executes in a
 * single transaction: there is never a board without its OWNER row (the invariant authorization relies on).
 */
export async function createBoard(userId: string, input: CreateBoardInput) {
  const board = await prisma.board.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      ownerId: userId,
      members: { create: { userId, role: "OWNER" } },
    },
    select: summarySelect,
  });
  return toBoardSummary(board, "OWNER");
}

/**
 * Everything the frontend needs to render a board, in a fixed number of queries
 * (board + members/users + columns + tasks), independent of how many rows each has -> no N+1.
 */
export async function getBoardDetail(boardId: string, myRole: BoardRole) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      id: true,
      name: true,
      description: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, avatar: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      columns: {
        select: { id: true, boardId: true, title: true, position: true, createdAt: true, updatedAt: true },
        orderBy: { position: "asc" },
      },
      tasks: {
        select: taskSelect,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!board) throw boardNotFound();

  return { ...board, myRole, tasks: board.tasks.map(toTaskDto) };
}

export async function updateBoard(boardId: string, input: UpdateBoardInput, myRole: BoardRole) {
  try {
    const board = await prisma.board.update({
      where: { id: boardId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
      },
      select: summarySelect,
    });
    return toBoardSummary(board, myRole);
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw boardNotFound(); // deleted between the permission check and now
    throw error;
  }
}

/** Members, columns, tasks (and their comments / activity) are removed by the database's ON DELETE CASCADE rules. */
export async function deleteBoard(boardId: string): Promise<void> {
  try {
    await prisma.board.delete({ where: { id: boardId } });
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw boardNotFound();
    throw error;
  }
}
