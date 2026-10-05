// Runs in the plain Node environment (NO window/document), like Next's build-time prerender.
// A component that touches browser globals while rendering passes jsdom tests but breaks `next build`.
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
import BoardPage from "@/app/boards/[boardId]/page";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import { nav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

describe("server-side rendering (no browser globals)", () => {
  it("has no window in this environment (guards the guard)", () => {
    expect(typeof window).toBe("undefined");
  });

  it("renders the login page", () => {
    const html = renderToString(<LoginPage />);
    expect(html).toContain("Log in");
    expect(html).toContain('href="/register"');
  });

  it("renders the register page", () => {
    const html = renderToString(<RegisterPage />);
    expect(html).toContain("Create your account");
    expect(html).toContain('href="/login"');
  });

  it("renders the dashboard and board pages' pre-auth state", () => {
    nav.params = { boardId: "b1" };
    expect(renderToString(<DashboardPage />)).toContain("Loading…");
    expect(renderToString(<BoardPage />)).toContain("Loading…");
  });
});
