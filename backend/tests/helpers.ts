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
