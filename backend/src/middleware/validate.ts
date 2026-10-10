import type { RequestHandler } from "express";
import type { z } from "zod";
import { AppError } from "../utils/AppError";

/** Validates req.body against a Zod schema and replaces it with the parsed (trimmed/normalised, unknown keys stripped) value. */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Invalid request data",
        result.error.issues.map((i) => ({ field: i.path.join(".") || "body", message: i.message }))
      );
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates a query string. Express 5's req.query is read-only, so (unlike validateBody) the parsed value is
 * returned to the caller instead of being written back.
 */
export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "Invalid query parameters",
      result.error.issues.map((i) => ({ field: i.path.join(".") || "query", message: i.message }))
    );
  }
  return result.data;
}
