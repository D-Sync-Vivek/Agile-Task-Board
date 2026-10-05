import { ApiError } from "@/lib/api/client";

/** A short, user-presentable message for any thrown value. */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!(error instanceof ApiError)) return fallback;
  // For validation failures the specific rule ("Column title must be at most 100 characters") is more useful than
  // the generic "Invalid request data".
  if (error.code === "VALIDATION_ERROR") {
    const first = getFieldErrors(error);
    const message = Object.values(first)[0];
    if (message) return message;
  }
  return error.message || fallback;
}

/** Field-level validation messages from a 422 response, keyed by field name (first message wins). */
export function getFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR" || !Array.isArray(error.details)) return {};
  const result: Record<string, string> = {};
  for (const item of error.details as { field?: unknown; message?: unknown }[]) {
    if (typeof item?.field === "string" && typeof item?.message === "string" && !(item.field in result)) {
      result[item.field] = item.message;
    }
  }
  return result;
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}
