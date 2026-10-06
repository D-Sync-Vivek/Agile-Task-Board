// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import Toaster from "@/components/ui/Toaster";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useToastStore } from "@/store/useToastStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, apiError, deferred, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";
import { nav, resetNav, router } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const me = { id: "u1", name: "Vivek Kumar", email: "vivek@example.com", avatar: null, createdAt: "2026-10-04T00:00:00.000Z" };

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: me });
  // jsdom lacks ResizeObserver, which dnd-kit's measuring uses.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

const renderPage = () =>
  render(
    <>
      <BoardPage />
      <Toaster />
    </>
  );

describe("loading, error and empty states", () => {
  it("shows a loading message, then the board", async () => {
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    renderPage();
    expect(await screen.findByText("Loading board…")).toBeInTheDocument();

    d.resolve({ board: makeBoard() });
    expect(await screen.findByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("Doing")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sprint Board" })).toBeInTheDocument();
    expect(screen.getByText("Your role: Owner")).toBeInTheDocument();
    expect(api.boards.get).toHaveBeenCalledWith("b1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("says when the board doesn't exist (404)", async () => {
    api.boards.get.mockRejectedValueOnce(apiError(404, "BOARD_NOT_FOUND", "Board not found"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Board not found.");
    expect(screen.getByRole("link", { name: "Back to my boards" })).toHaveAttribute("href", "/");
  });

  it("offers Retry for other failures, and Retry recovers", async () => {
    api.boards.get.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    renderPage();
    expect(await screen.findByText("Unable to load this board.")).toBeInTheDocument();

    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Todo")).toBeInTheDocument();
    expect(screen.queryByText("Unable to load this board.")).not.toBeInTheDocument();
  });

  it("shows an empty-board message when there are no columns", async () => {
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [], tasks: [] }) });
    renderPage();
    expect(await screen.findByText(/No columns yet\./)).toHaveTextContent("Click + to create your first column.");
  });

  it("sends anonymous visitors to the login page, remembering where they were", async () => {
    useAuthStore.setState({ status: "anonymous", user: null });
    renderPage();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=%2Fboards%2Fb1"));
    expect(api.boards.get).not.toHaveBeenCalled();
  });

  it("offers Retry when the server is unreachable during the session check", async () => {
    useAuthStore.setState({ status: "error", user: null });
    renderPage();
    expect(await screen.findByText("Unable to reach the server.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled(); // an outage is not a reason to log the user out
  });

  it("cancels the board request when the page is left", async () => {
    const d = deferred();
    api.boards.get.mockReturnValueOnce(d.promise);
    const { unmount } = renderPage();
    await screen.findByText("Loading board…");
    const signal = api.boards.get.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

describe("permission-aware controls", () => {
  it("OWNER sees add/delete controls", async () => {
    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    renderPage();
    await screen.findByText("Todo");
    expect(screen.getByRole("button", { name: "Add column" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "+ Add Task" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete task" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Delete column Todo" })).toBeInTheDocument();
  });

  it("VIEWER sees the board read-only", async () => {
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ myRole: "VIEWER", myPermissions: VIEWER_PERMISSIONS }) });
    renderPage();
    await screen.findByText("Todo");
    expect(screen.getByText("Your role: Viewer (read-only)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add column" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add Task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete column/ })).not.toBeInTheDocument();

    // double-click must not open the editor
    fireEvent.doubleClick(screen.getByText("Write tests"));
    expect(screen.queryByPlaceholderText("Task Content here")).not.toBeInTheDocument();
  });

  it("MEMBER can add and edit tasks but not delete tasks or columns", async () => {
    const memberPermissions = ALL_PERMISSIONS.filter((p) => ["board:view", "task:create", "task:update", "task:move", "comment:create"].includes(p));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ myRole: "MEMBER", myPermissions: memberPermissions }) });
    renderPage();
    await screen.findByText("Todo");
    expect(screen.getAllByRole("button", { name: "+ Add Task" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete column/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add column" })).not.toBeInTheDocument();
  });
});

describe("actions go through the API", () => {
  async function ready(board = makeBoard()) {
    api.boards.get.mockResolvedValueOnce({ board });
    renderPage();
    await screen.findByText("Todo");
  }

  it("adds a column only after the server confirms, and disables the button meanwhile", async () => {
    await ready();
    const d = deferred();
    api.columns.create.mockReturnValueOnce(d.promise);
    await userEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    expect(screen.queryByText("Column 3")).not.toBeInTheDocument();

    d.resolve({ column: makeColumn("c3", "Column 3", 2) });
    expect(await screen.findByText("Column 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add column" })).toBeEnabled();
  });

  it("adds a task to the clicked column", async () => {
    await ready();
    api.tasks.create.mockResolvedValueOnce({ task: makeTask("t9", "c2", "Double Click to edit", 1) });
    await userEvent.click(screen.getAllByRole("button", { name: "+ Add Task" })[1]); // the Doing column
    expect(await screen.findByText("Double Click to edit")).toBeInTheDocument();
    expect(api.tasks.create).toHaveBeenCalledWith("b1", { title: "Double Click to edit", columnId: "c2" });
  });

  it("deletes a task immediately and restores it with a toast if the server refuses", async () => {
    await ready();
    const d = deferred();
    api.tasks.delete.mockReturnValueOnce(d.promise);
    const card = screen.getByText("Write tests").closest("div.task") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "Delete task" }));
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument(); // gone before the server answered

    api.boards.get.mockResolvedValueOnce({ board: makeBoard() });
    d.reject(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    expect(await screen.findByText("Write tests")).toBeInTheDocument(); // rolled back
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("renames a column from a pre-filled editor", async () => {
    await ready();
    api.columns.rename.mockResolvedValueOnce({ column: makeColumn("c1", "Backlog", 0) });
    fireEvent.doubleClick(screen.getByText("Todo"));
    const box = await screen.findByPlaceholderText("Enter title");
    expect(box).toHaveValue("Todo");
    const u = userEvent.setup();
    await u.clear(box);
    await u.type(box, "Backlog{Enter}");
    expect(await screen.findByText("Backlog")).toBeInTheDocument();
    expect(api.columns.rename).toHaveBeenCalledWith("c1", { title: "Backlog" });
  });

  it("deletes a column with its tasks, immediately", async () => {
    await ready();
    api.columns.delete.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByRole("button", { name: "Delete column Todo" }));
    expect(screen.queryByText("Todo")).not.toBeInTheDocument();
    expect(screen.queryByText("Write tests")).not.toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument(); // other column untouched
    await waitFor(() => expect(api.columns.delete).toHaveBeenCalledWith("c1"));
  });
});
