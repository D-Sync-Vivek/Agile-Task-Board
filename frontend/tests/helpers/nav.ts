import { vi } from "vitest";

/** Shared fake of next/navigation: `vi.mock("next/navigation", () => import("../helpers/nav"))`. */
export const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() };
export const nav = { pathname: "/", params: {} as Record<string, string> };

export const useRouter = () => router;
export const usePathname = () => nav.pathname;
export const useParams = () => nav.params;

export function resetNav() {
  Object.values(router).forEach((m) => m.mockReset());
  nav.pathname = "/";
  nav.params = {};
}
