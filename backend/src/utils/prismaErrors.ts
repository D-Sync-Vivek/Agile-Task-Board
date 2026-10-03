import { Prisma } from "../generated/prisma/client";

/** True if `error` is a Prisma known-request error with the given code (e.g. "P2002" unique, "P2025" record not found). */
export function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
