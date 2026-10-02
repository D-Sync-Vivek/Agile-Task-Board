import { rateLimit } from "express-rate-limit";
import { AppError } from "../utils/AppError";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

/** Per-IP limiter for credential endpoints (brute force / credential stuffing). In-memory: fine for one instance. */
export function createAuthRateLimiter({ limit, windowMs }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, "RATE_LIMITED", "Too many attempts. Please try again later."));
    },
  });
}
