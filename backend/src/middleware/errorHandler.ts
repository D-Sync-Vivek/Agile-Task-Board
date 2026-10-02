import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../utils/AppError";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", `Route not found: ${req.method} ${req.path}`));
};

// Every error response has the same shape: { success: false, error: { code, message, details? } }
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
    });
    return;
  }

  // Errors raised by express.json()
  const type = (err as { type?: string })?.type;
  if (type === "entity.parse.failed") {
    res.status(400).json({ success: false, error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large" } });
    return;
  }

  // Unknown error: log the details server-side, never leak them to the client.
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
};
