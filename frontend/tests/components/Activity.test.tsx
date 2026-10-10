// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardActivityStore, useTaskActivityStore } from "@/store/useActivityStores";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { useToastStore } from "@/store/useToastStore";
import type { ActivityPage } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { VIEWER_PERMISSIONS, apiError, deferred, makeActivity, makeBoard, makeColumn, makeComment, makeTask } from "../helpers/fixtures";
import { nav, resetNav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const NOW = "2026-10-04T10:00:00.000Z";
const ME = { id: "u1", name: "Vivek Kumar", email: "u1@example.com", avatar: null, createdAt: NOW };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const moved = (id: string, over = {}) =>
  makeActivity(id, { action: "TASK_MOVED", entityType: "TASK", metadata: { taskTitle: "Dashboard UI", fromColumn: { id: "c1", title: "Todo" }, toColumn: { id: "c2", title: "In Progress" } } }, over);
const created = (id: string, over = {}) =>
  makeActivity(id, { action: "TASK_CREATED", entityType: "TASK", metadata: { taskTitle: "Authentication", columnTitle: "Todo" } }, { actor: { id: "u1", name: "Vivek Kumar", avatar: null }, ...over });
const page = (activities: ActivityPage["activities"], nextCursor: string | null = null): ActivityPage => ({ activities, nextCursor });

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useCommentStore.getState().reset();
  useBoardActivityStore.getState().reset();
  useTaskActivityStore.getState().reset();
  useTaskPanelStore.getState().close();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: ME });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.comments.list.mockResolvedValue({ comments: [] });
});

async function renderBoard(over: Parameters<typeof makeBoard>[0] = {}) {
  api.boards.get.mockResolvedValueOnce({
    board: makeBoard({ columns: [makeColumn("c1", "Todo", 0)], tasks: [makeTask("t1", "c1", "Authentication", 0)], ...over }),
  });
  render(<BoardPage />);
  await screen.findByText("Authentication");
}

const openBoardActivity = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Activity" }));
  return screen.findByRole("dialog", { name: "Board activity" });
};

describe("board activity drawer", () => {
  it("opens from the header, loads the board's feed, and shows who did what (\"You\" for the signed-in user)", async () => {
    api.activity.forBoard.mockResolvedValue(page([moved("a2", { createdAt: minutesAgo(2) }), created("a1", { createdAt: minutesAgo(30) })]));
    await renderBoard();
    const drawer = await openBoardActivity();

    expect(await within(drawer).findByText("moved “Dashboard UI” from Todo to In Progress")).toBeInTheDocument();
    expect(within(drawer).getByText("Mia Member")).toBeInTheDocument();
    expect(within(drawer).getByText("You")).toBeInTheDocument();
    expect(within(drawer).getByText("created task “Authentication” in Todo")).toBeInTheDocument();
    expect(within(drawer).getByText("2 min ago")).toBeInTheDocument();
    expect(api.activity.forBoard).toHaveBeenCalledWith("b1", { limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("shows loading, then the empty state", async () => {
    const d = deferred<ActivityPage>();
    api.activity.forBoard.mockReturnValueOnce(d.promise);
    await renderBoard();
    const drawer = await openBoardActivity();
    expect(within(drawer).getByText("Loading activity…")).toBeInTheDocument();
    d.resolve(page([]));
    expect(await within(drawer).findByText("No activity on this board yet.")).toBeInTheDocument();
  });

  it("shows an error with Retry that recovers", async () => {
    api.activity.forBoard.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Server exploded"));
    await renderBoard();
    const drawer = await openBoardActivity();
    expect(await within(drawer).findByText("Server exploded")).toBeInTheDocument();

    api.activity.forBoard.mockResolvedValueOnce(page([created("a1")]));
    await userEvent.click(within(drawer).getByRole("button", { name: "Retry" }));
    expect(await within(drawer).findByText("created task “Authentication” in Todo")).toBeInTheDocument();
  });

  it("pages with Load more and hides the button after the last page", async () => {
    api.activity.forBoard.mockResolvedValueOnce(page([moved("a2")], "a2")).mockResolvedValueOnce(page([created("a1")]));
    await renderBoard();
    const drawer = await openBoardActivity();
    await within(drawer).findByText("moved “Dashboard UI” from Todo to In Progress");

    await userEvent.click(within(drawer).getByRole("button", { name: "Load more" }));
    expect(await within(drawer).findByText("created task “Authentication” in Todo")).toBeInTheDocument();
    expect(api.activity.forBoard).toHaveBeenLastCalledWith("b1", { limit: 20, cursor: "a2" }, undefined);
    expect(within(drawer).queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("closes with × and Escape, returns focus to the Activity button, and re-reads the feed next time", async () => {
    api.activity.forBoard.mockResolvedValue(page([created("a1")]));
    await renderBoard();
    const opener = screen.getByRole("button", { name: "Activity" });

    await openBoardActivity();
    await userEvent.click(screen.getByRole("button", { name: "Close activity" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    await openBoardActivity();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.activity.forBoard).toHaveBeenCalledTimes(2);
  });

  it("is available to a read-only VIEWER", async () => {
    api.activity.forBoard.mockResolvedValue(page([created("a1")]));
    await renderBoard({ myRole: "VIEWER", myPermissions: VIEWER_PERMISSIONS });
    const drawer = await openBoardActivity();
    expect(await within(drawer).findByText("created task “Authentication” in Todo")).toBeInTheDocument();
  });
});

describe("task activity in the detail panel", () => {
  async function openPanel() {
    await renderBoard();
    await userEvent.click(screen.getByText("Authentication"));
    return screen.findByRole("dialog", { name: "Task details" });
  }

  it("shows this task's history, loaded from the task endpoint", async () => {
    api.activity.forTask.mockResolvedValue(page([moved("a2"), created("a1")]));
    const panel = await openPanel();
    expect(await within(panel).findByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(await within(panel).findByText("moved “Dashboard UI” from Todo to In Progress")).toBeInTheDocument();
    expect(api.activity.forTask).toHaveBeenCalledWith("t1", { limit: 20 }, expect.anything());
    expect(api.activity.forBoard).not.toHaveBeenCalled();
  });

  it("shows an empty state, and an error with Retry that doesn't disturb the comments", async () => {
    api.comments.list.mockResolvedValue({ comments: [makeComment("c1", "u2", "Mia Member", "Looks good")] });
    api.activity.forTask.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Activity is down"));
    const panel = await openPanel();
    expect(await within(panel).findByText("Activity is down")).toBeInTheDocument();
    expect(within(panel).getByText("Looks good")).toBeInTheDocument(); // comments unaffected

    api.activity.forTask.mockResolvedValueOnce(page([]));
    await userEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(await within(panel).findByText("No activity yet.")).toBeInTheDocument();
  });

  it("does not fetch twice just because the comments finished loading", async () => {
    api.comments.list.mockResolvedValue({ comments: [makeComment("c1", "u2", "Mia Member", "one"), makeComment("c2", "u2", "Mia Member", "two")] });
    api.activity.forTask.mockResolvedValue(page([created("a1")]));
    const panel = await openPanel();
    await within(panel).findByText("two");
    await within(panel).findByText("created task “Authentication” in Todo");
    expect(api.activity.forTask).toHaveBeenCalledTimes(1);
  });

  it("re-reads the history after the task is saved, and then shows the new entry", async () => {
    api.activity.forTask.mockResolvedValueOnce(page([created("a1")]));
    const panel = await openPanel();
    await within(panel).findByText("created task “Authentication” in Todo");

    api.tasks.update.mockResolvedValueOnce({ task: { ...makeTask("t1", "c1", "Auth v2", 0), updatedAt: "2026-10-05T09:00:00.000Z" } });
    api.activity.forTask.mockResolvedValueOnce(
      page([
        makeActivity("a3", { action: "TASK_UPDATED", entityType: "TASK", metadata: { taskTitle: "Auth v2", changes: { title: { from: "Authentication", to: "Auth v2" } } } }),
        created("a1"),
      ])
    );
    const title = within(panel).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Auth v2");
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    expect(await within(panel).findByText("updated “Auth v2” (renamed from “Authentication”)")).toBeInTheDocument();
    expect(within(panel).getByText("created task “Authentication” in Todo")).toBeInTheDocument(); // old entries stay
    expect(api.activity.forTask).toHaveBeenCalledTimes(2);
  });

  it("re-reads the history after a comment is posted (once the server confirmed it)", async () => {
    api.activity.forTask.mockResolvedValueOnce(page([created("a1")]));
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");

    const post = deferred();
    api.comments.create.mockReturnValueOnce(post.promise);
    api.activity.forTask.mockResolvedValueOnce(page([makeActivity("a4", { action: "COMMENT_ADDED", entityType: "COMMENT", metadata: { taskId: "t1", taskTitle: "Authentication" } }, { actor: { id: "u1", name: "Vivek Kumar", avatar: null } }), created("a1")]));
    await userEvent.type(within(panel).getByLabelText("Write a comment"), "Done");
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));

    // Still pending: the optimistic comment is not yet history.
    expect(api.activity.forTask).toHaveBeenCalledTimes(1);

    post.resolve({ comment: makeComment("c9", "u1", "Vivek Kumar", "Done") });
    expect(await within(panel).findByText("commented on “Authentication”")).toBeInTheDocument();
    expect(api.activity.forTask).toHaveBeenCalledTimes(2);
  });

  it("does not re-read the history when a comment is deleted (no history entry is written for that)", async () => {
    api.comments.list.mockResolvedValue({ comments: [makeComment("c1", "u1", "Vivek Kumar", "mine")] });
    api.comments.delete.mockResolvedValue(null);
    api.activity.forTask.mockResolvedValue(page([created("a1")]));
    const panel = await openPanel();
    await within(panel).findByText("mine");
    await userEvent.click(within(panel).getByRole("button", { name: /Delete comment/ }));
    await waitFor(() => expect(within(panel).queryByText("mine")).not.toBeInTheDocument());
    expect(api.activity.forTask).toHaveBeenCalledTimes(1);
  });

  it("clears the feed when the panel closes so another task never shows stale history", async () => {
    api.activity.forTask.mockResolvedValue(page([created("a1")]));
    const panel = await openPanel();
    await within(panel).findByText("created task “Authentication” in Todo");
    await userEvent.click(within(panel).getByRole("button", { name: "Close task details" }));
    expect(useTaskActivityStore.getState()).toMatchObject({ scopeId: null, entries: [], status: "idle" });
  });
});
