import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage, getFieldErrors, isApiError } from "@/lib/errors";

describe("getErrorMessage", () => {
  it("uses the API message for ordinary errors", () => {
    expect(getErrorMessage(new ApiError(409, "EMAIL_ALREADY_EXISTS", "An account with this email already exists"))).toBe("An account with this email already exists");
  });

  it("prefers the specific rule for validation errors", () => {
    const error = new ApiError(422, "VALIDATION_ERROR", "Invalid request data", [{ field: "title", message: "Column title must be at most 100 characters" }]);
    expect(getErrorMessage(error)).toBe("Column title must be at most 100 characters");
  });

  it("falls back for unknown values", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
    expect(getErrorMessage("x")).toMatch(/something went wrong/i);
  });
});

describe("getFieldErrors", () => {
  it("maps validation details by field, first message wins", () => {
    const error = new ApiError(422, "VALIDATION_ERROR", "Invalid", [
      { field: "email", message: "Enter a valid email address" },
      { field: "email", message: "second" },
      { field: "password", message: "Password must be at least 8 characters" },
    ]);
    expect(getFieldErrors(error)).toEqual({ email: "Enter a valid email address", password: "Password must be at least 8 characters" });
  });

  it("is empty for non-validation errors and malformed details", () => {
    expect(getFieldErrors(new ApiError(401, "INVALID_CREDENTIALS", "x"))).toEqual({});
    expect(getFieldErrors(new ApiError(422, "VALIDATION_ERROR", "x", "not-an-array"))).toEqual({});
    expect(getFieldErrors(new ApiError(422, "VALIDATION_ERROR", "x", [{ nope: 1 }, null]))).toEqual({});
    expect(getFieldErrors(new Error("x"))).toEqual({});
  });
});

describe("isApiError", () => {
  it("matches by class and optionally status", () => {
    const e = new ApiError(404, "NOT_FOUND", "x");
    expect(isApiError(e)).toBe(true);
    expect(isApiError(e, 404)).toBe(true);
    expect(isApiError(e, 500)).toBe(false);
    expect(isApiError(new Error("x"))).toBe(false);
  });
});
