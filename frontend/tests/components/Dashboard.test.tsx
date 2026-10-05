// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardListStore } from "@/store/useBoardListStore";
import { useBoardStore } from "@/store/useBoardStore";
import type { BoardSummary } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred } from "../helpers/fixtures";
import { resetNav, router } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const me = { id: "u1", name: "Vivek Kumar", email: "vivek@example.com", avatar: null, createdAt: "2026-10-04T00:00:00.000Z" };
const summary = (over: Partial<BoardSummary> = {}): BoardSummary => ({
  id: "b1", name: "Internship Tracker", description: "Weekly goals", ownerId: "u1", createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z", myRole: "OWNER", memberCount: 3, taskCount: 12, ...over,
});

beforeEach(() => {
  resetApiMock();
  resetNav();
  useBoardListStore.getState().reset();
  useBoardStore.getState().reset();
  useAuthStore.setState({ status: "authenticated", user: me });
});

describe("boards dashboard", () => {
  it("shows a loading message, then board cards with counts and role", async () => {
    const d = deferred();
    api.boards.list.mockReturnValueOnce(d.promise);
    render(<DashboardPage />);
    expect(await screen.findByText("Loading boards…")).toBeInTheDocument();

    d.resolve({ boards: [summary(), summary({ id: "b2", name: "Personal Projects", description: null, myRole: "VIEWER", memberCount: 1, taskCount: 1 })] });
    expect(await screen.findByText("Internship Tracker")).toBeInTheDocument();
    expect(screen.getByText("12 tasks · 3 members")).toBeInTheDocument();
    expect(screen.getByText("1 task · 1 member")).toBeInTheDocument(); // singular forms
    expect(screen.getByText("VIEWER")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Internship Tracker/ })).toHaveAttribute("href", "/boards/b1");
  });

  it("shows an empty state for a new user", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [] });
    render(<DashboardPage />);
    expect(await screen.findByText(/don't have any boards yet/i)).toBeInTheDocument();
  });

  it("shows an error with Retry that recovers", async () => {
    api.boards.list.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    render(<DashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");

    api.boards.list.mockResolvedValueOnce({ boards: [summary()] });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Internship Tracker")).toBeInTheDocument();
  });

  it("creates a board and opens it", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [] });
    api.boards.create.mockResolvedValueOnce({ board: summary({ id: "new1", name: "Fresh", memberCount: 1, taskCount: 0 }) });
    render(<DashboardPage />);
    await screen.findByText(/don't have any boards yet/i);

    const create = screen.getByRole("button", { name: "Create board" });
    expect(create).toBeDisabled(); // blank name
    await userEvent.type(screen.getByLabelText("New board name"), "Fresh");
    await userEvent.click(create);

    expect(api.boards.create).toHaveBeenCalledWith({ name: "Fresh" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/boards/new1"));
  });

  it("shows why board creation failed and lets the user retry", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [] });
    api.boards.create.mockRejectedValueOnce(new ApiError(422, "VALIDATION_ERROR", "Invalid request data", [{ field: "name", message: "Board name must be at most 100 characters" }]));
    render(<DashboardPage />);
    await screen.findByText(/don't have any boards yet/i);
    await userEvent.type(screen.getByLabelText("New board name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Board name must be at most 100 characters");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create board" })).toBeEnabled();
  });

  it("redirects anonymous visitors to /login and loads nothing", async () => {
    useAuthStore.setState({ status: "anonymous", user: null });
    render(<DashboardPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2F"));
    expect(api.boards.list).not.toHaveBeenCalled();
  });
});

describe("header: logout", () => {
  it("logs out, wipes cached data and returns to the login page", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [summary()] });
    api.auth.logout.mockResolvedValueOnce(null);
    render(<DashboardPage />);
    await screen.findByText("Internship Tracker");
    expect(screen.getByText("Vivek Kumar")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(api.auth.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({ status: "anonymous", user: null });
    expect(useBoardListStore.getState().boards).toEqual([]); // previous user's data is gone
  });
});
