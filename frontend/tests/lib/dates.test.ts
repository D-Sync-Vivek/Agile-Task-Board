import { afterEach, describe, expect, it } from "vitest";
import { formatDueDate, formatRelativeTime, formatTimestamp } from "@/lib/dates";

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("formatDueDate (calendar dates)", () => {
  it("formats a YYYY-MM-DD date", () => {
    expect(formatDueDate("2026-10-15", { locale: "en-US" })).toBe("Oct 15, 2026");
    expect(formatDueDate("2026-01-05", { locale: "en-US" })).toBe("Jan 5, 2026");
  });

  it.each(["America/Los_Angeles", "Pacific/Auckland", "UTC", "Asia/Kolkata"])("shows the same day in %s (no time-zone shift)", (tz) => {
    process.env.TZ = tz;
    expect(formatDueDate("2026-10-15", { locale: "en-US" })).toBe("Oct 15, 2026");
  });

  it("documents the bug this avoids: the naive approach shifts the day west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(new Date("2026-10-15").toLocaleDateString("en-US", { day: "numeric" })).toBe("14");
  });

  it("returns the raw value for anything that isn't a real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "15/10/2026", "", "tomorrow"]) expect(formatDueDate(bad)).toBe(bad);
  });
});

describe("formatTimestamp (instants)", () => {
  it("formats an ISO timestamp in the requested time zone", () => {
    expect(formatTimestamp("2026-10-04T10:00:00.000Z", { locale: "en-US", timeZone: "UTC" })).toMatch(/Oct 4, 2026.*10:00.*AM/);
    expect(formatTimestamp("2026-10-04T10:00:00.000Z", { locale: "en-US", timeZone: "Asia/Kolkata" })).toMatch(/Oct 4, 2026.*3:30.*PM/);
  });

  it("returns the raw value for an invalid timestamp", () => {
    expect(formatTimestamp("not a date")).toBe("not a date");
  });
});

describe("formatRelativeTime", () => {
  const NOW = Date.parse("2026-10-04T12:00:00.000Z");
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  it.each([
    [0, "Just now"],
    [30, "Just now"],
    [44, "Just now"],
    [45, "1 min ago"],
    [89, "1 min ago"],
    [120, "2 min ago"],
    [59 * 60, "59 min ago"],
    [60 * 60, "1 h ago"],
    [5 * 3600, "5 h ago"],
    [23 * 3600, "23 h ago"],
    [24 * 3600, "1 d ago"],
    [3 * 86400, "3 d ago"],
  ])("%is ago reads %j", (seconds, expected) => {
    expect(formatRelativeTime(ago(seconds), NOW)).toBe(expected);
  });

  it("falls back to a plain date after a week", () => {
    expect(formatRelativeTime("2026-09-01T12:00:00.000Z", NOW, { locale: "en-US" })).toBe("Sep 1, 2026");
  });

  it("treats a slightly-future timestamp (clock skew) as just now, and returns invalid input unchanged", () => {
    expect(formatRelativeTime(new Date(NOW + 5000).toISOString(), NOW)).toBe("Just now");
    expect(formatRelativeTime("garbage", NOW)).toBe("garbage");
  });
});
