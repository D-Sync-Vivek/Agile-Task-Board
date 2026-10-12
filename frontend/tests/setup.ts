import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { fake } from "./helpers/fakeSocket";

// Unit tests never open a real WebSocket: every test sees the fake from tests/helpers/fakeSocket.ts.
vi.mock("@/lib/realtime/socket", () => import("./helpers/fakeSocket"));

// Vitest has no globals, so React Testing Library can't auto-register its cleanup.
afterEach(() => {
  cleanup();
  fake.reset();
});
