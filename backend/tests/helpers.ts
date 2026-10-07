import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { registerUser, signAuthToken } from "../src/services/auth.service";
import { AUTH_COOKIE_NAME } from "../src/utils/cookies";

export async function resetDatabase() {
  // CASCADE clears every table that references users (boards, members, tasks, ...).
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
}

/** Creates a user directly via the service and returns their id plus a ready-to-send auth Cookie header value. */
export async function createUser(name: string) {
  const user = await registerUser({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    password: "password123",
  });
  return { id: user.id, cookie: `${AUTH_COOKIE_NAME}=${signAuthToken(user.id)}` };
}

/** Creates a board whose owner has the OWNER membership row (the invariant the board service will maintain). */
export async function createBoardWithMembers(ownerId: string, others: { userId: string; role: BoardRole }[] = []) {
  const board = await prisma.board.create({
    data: {
      name: "Test board",
      ownerId,
      members: { create: [{ userId: ownerId, role: "OWNER" }, ...others] },
    },
  });
  return board.id;
}

export async function createColumn(boardId: string, title: string, position: number) {
  return prisma.column.create({ data: { boardId, title, position } });
}

export async function createTask(opts: {
  boardId: string;
  columnId: string;
  createdById: string;
  title: string;
  position: number;
  assigneeId?: string;
  dueDate?: string; // "YYYY-MM-DD"
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}) {
  return prisma.task.create({
    data: {
      boardId: opts.boardId,
      columnId: opts.columnId,
      createdById: opts.createdById,
      title: opts.title,
      position: opts.position,
      assigneeId: opts.assigneeId,
      priority: opts.priority,
      dueDate: opts.dueDate ? new Date(opts.dueDate) : undefined,
    },
  });
}

export async function createComment(taskId: string, userId: string, content: string, at?: Date) {
  const when = at ?? new Date();
  return prisma.comment.create({ data: { taskId, userId, content, createdAt: when, updatedAt: when } });
}
