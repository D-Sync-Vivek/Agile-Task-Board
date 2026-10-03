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
