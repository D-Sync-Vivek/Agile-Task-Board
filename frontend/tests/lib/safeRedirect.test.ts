import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safeRedirect";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/boards/abc", "/boards/abc"],
    ["/boards/abc?tab=1#x", "/boards/abc?tab=1#x"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.com",
    "http://evil.com/boards",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    "boards/abc",
    "/ok\r\nSet-Cookie: x=1",
    "/ok\u0000",
    "",
  ])("rejects %j and falls back to /", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("falls back for null/undefined", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});
