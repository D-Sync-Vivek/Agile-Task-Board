import type { RequestHandler } from "express";
import { getPublicUserById, verifyAuthToken } from "../services/auth.service";
import { AppError } from "../utils/AppError";
import { AUTH_COOKIE_NAME } from "../utils/cookies";

/**
 * 1. read the cookie  2. verify the JWT  3. load the user from the DB  4. attach it as req.user
 * Anything missing/invalid -> 401. Loading the user means a deleted account stops working immediately.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof token !== "string" || token.length === 0) {
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  }

  const userId = verifyAuthToken(token);
  const user = userId ? await getPublicUserById(userId) : null;
  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid or expired session");
  }

  req.user = user;
  next();
};
