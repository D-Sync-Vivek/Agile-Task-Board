import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { fake } from "./helpers/fakeSocket";

// Unit tests never open a real WebSocket: every test sees the fake from tests/helpers/fakeSocket.ts.
vi.mock("@/lib/realtime/socket", () => import("./helpers/fakeSocket"));

// Date formatting without an explicit locale follows the developer's OS (e.g. "15 Oct 2026" on en-GB/en-IN).
// Pin the default to en-US so assertions like "Oct 15, 2026" pass on every machine.
const toLocaleDateString = Date.prototype.toLocaleDateString;
Date.prototype.toLocaleDateString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
  return toLocaleDateString.call(this, locales ?? "en-US", options);
};
const toLocaleString = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
  return toLocaleString.call(this, locales ?? "en-US", options);
};

// Vitest has no globals, so React Testing Library can't auto-register its cleanup.
afterEach(() => {
  cleanup();
  fake.reset();
});