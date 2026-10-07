import { vi } from "vitest";

// Replaces "@/lib/api" in tests: `vi.mock("@/lib/api", () => import("../helpers/apiMock"))`.
export { ApiError } from "@/lib/api/client";

const fn = () => vi.fn();
export const api = {
  auth: { register: fn(), login: fn(), logout: fn(), me: fn() },
  boards: { list: fn(), create: fn(), get: fn(), update: fn(), delete: fn() },
  columns: { create: fn(), rename: fn(), delete: fn(), reorder: fn() },
  tasks: { list: fn(), create: fn(), get: fn(), update: fn(), delete: fn(), move: fn(), assign: fn() },
  comments: { list: fn(), create: fn(), update: fn(), delete: fn() },
};

export function resetApiMock() {
  for (const group of Object.values(api)) for (const mock of Object.values(group)) mock.mockReset();
}
