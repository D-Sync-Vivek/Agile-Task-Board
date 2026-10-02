import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { Prisma } from "../generated/prisma/client";
import type { User } from "../generated/prisma/client";
import type { LoginInput, RegisterInput } from "../validators/auth.validator";
import { AppError } from "../utils/AppError";

/** The only user shape that ever leaves the backend. passwordHash is deliberately absent. */
export type PublicUser = Pick<User, "id" | "name" | "email" | "avatar" | "createdAt">;

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

function toPublicUser(user: User): PublicUser {
  const { id, name, email, avatar, createdAt } = user;
  return { id, name, email, avatar, createdAt };
}

// Compared against when the email is unknown so "no such user" and "wrong password"
// take the same time (otherwise response time reveals which emails are registered).
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash("not-a-real-password", env.BCRYPT_ROUNDS);
  return dummyHash;
}

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  try {
    return await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUserSelect,
    });
  } catch (error) {
    // The unique index on email is the real guard; this also covers two simultaneous registrations.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists");
    }
    throw error;
  }
}

export async function authenticateUser(input: LoginInput): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !passwordMatches) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  return toPublicUser(user);
}

export function getPublicUserById(id: string): Promise<PublicUser | null> {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
}

export function signAuthToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: env.JWT_EXPIRES_IN_DAYS * 24 * 60 * 60,
  });
}

/** Returns the user id from a valid token, or null for anything invalid/expired/tampered. */
export function verifyAuthToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
