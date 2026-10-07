// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import Toaster from "@/components/ui/Toaster";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { useToastStore } from "@/store/useToastStore";
import type { BoardMemberDto, Permission } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, apiError, deferred, makeBoard, makeColumn, makeComment, makeTask } from "../helpers/fixtures";
import { nav, resetNav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const NOW = "2026-10-04T10:00:00.000Z";
const member = (id: string, userId: string, name: string, role: BoardMemberDto["role"]): BoardMemberDto => ({
  id, userId, role, createdAt: NOW, user: { id: userId, name, email: `${userId}@example.com`, avatar: null },
});
const ME = { id: "u1", name: "Vivek Kumar", email: "u1@example.com", avatar: null, createdAt: NOW };
const MEMBERS = [member("m1", "u1", "Vivek Kumar", "OWNER"), member("m2", "u2", "Mia Member", "MEMBER")];

const MEMBER_PERMISSIONS: Permission[] = ["board:view", "task:create", "task:update", "task:move", "comment:create"];
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter((p) => !["board:update", "board:delete"].includes(p));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useCommentStore.getState().reset();
  useTaskPanelStore.getState().close();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: ME });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.comments.list.mockResolvedValue({ comments: [] });
});

async function openPanel(opts: { permissions?: Permission[]; role?: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" } = {}) {
  api.boards.get.mockResolvedValueOnce({
    board: makeBoard({
      members: MEMBERS,
      myRole: opts.role ?? "OWNER",
      myPermissions: opts.permissions ?? ALL_PERMISSIONS,
      columns: [makeColumn("c1", "Todo", 0)],
      tasks: [makeTask("t1", "c1", "Authentication", 0), makeTask("t2", "c1", "Dashboard", 1)],
    }),
  });
  render(
    <>
      <BoardPage />
      <Toaster />
    </>
  );
  await userEvent.click(await screen.findByText("Authentication"));
  return screen.findByRole("dialog", { name: "Task details" });
}

const dialog = () => screen.getByRole("dialog", { name: "Task details" });
const composer = () => within(dialog()).getByLabelText("Write a comment");

describe("showing comments", () => {
  it("lists comments oldest first with author, relative time, '(you)', and an edited marker", async () => {
    api.comments.list.mockResolvedValue({
      comments: [
        makeComment("c1", "u2", "Mia Member", "Can we move this to the next sprint?", { createdAt: minutesAgo(2), updatedAt: minutesAgo(2) }),
        makeComment("c2", "u1", "Vivek Kumar", "Yes, I'll handle it.", { createdAt: minutesAgo(0), updatedAt: minutesAgo(0) }),
        makeComment("c3", "u2", "Mia Member", "Thanks!", { createdAt: minutesAgo(180), updatedAt: minutesAgo(179), edited: true }),
      ],
    });
    const panel = await openPanel();

    expect(await within(panel).findByText("Can we move this to the next sprint?")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Comments (3)" })).toBeInTheDocument();
    const items = within(panel).getAllByRole("listitem").filter((li) => li.textContent?.includes("Mia") || li.textContent?.includes("Vivek"));
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Mia Member"),
      expect.stringContaining("Vivek Kumar (you)"),
      expect.stringContaining("Mia Member"),
    ]);
    expect(within(panel).getByText("2 min ago")).toBeInTheDocument();
    expect(within(panel).getByText("Just now")).toBeInTheDocument();
    expect(within(panel).getByText(/3 h ago · edited/)).toBeInTheDocument();
    expect(api.comments.list).toHaveBeenCalledWith("t1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("shows loading, empty and error-with-retry states", async () => {
    const d = deferred();
    api.comments.list.mockReturnValueOnce(d.promise);
    const panel = await openPanel();
    expect(within(panel).getByText("Loading comments…")).toBeInTheDocument();

    d.resolve({ comments: [] });
    expect(await within(panel).findByText("No comments yet.")).toBeInTheDocument();
  });

  it("offers Retry when loading fails", async () => {
    api.comments.list.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    const panel = await openPanel();
    expect(await within(panel).findByText("Something went wrong")).toBeInTheDocument();

    api.comments.list.mockResolvedValueOnce({ comments: [makeComment("c1", "u2", "Mia Member", "Recovered")] });
    await userEvent.click(within(panel).getByRole("button", { name: "Retry" }));
    expect(await within(panel).findByText("Recovered")).toBeInTheDocument();
  });

  it("loads the comments of whichever task is opened", async () => {
    api.comments.list.mockImplementation(async (taskId: string) => ({ comments: taskId === "t1" ? [makeComment("c1", "u2", "Mia Member", "about auth")] : [makeComment("c2", "u2", "Mia Member", "about dashboard", { taskId: "t2" })] }));
    await openPanel();
    expect(await screen.findByText("about auth")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close task details" }));
    await userEvent.click(screen.getByText("Dashboard"));
    expect(await screen.findByText("about dashboard")).toBeInTheDocument();
    expect(screen.queryByText("about auth")).not.toBeInTheDocument();
    expect(api.comments.list).toHaveBeenLastCalledWith("t2", expect.anything());
  });
});

describe("posting", () => {
  it("shows the comment immediately (pending, no actions), then confirms it", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    const d = deferred();
    api.comments.create.mockReturnValueOnce(d.promise);

    await userEvent.type(composer(), "  Yes, I'll handle it.  ");
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));

    expect(composer()).toHaveValue(""); // box empties at once
    expect(await within(panel).findByText("Yes, I'll handle it.")).toBeInTheDocument();
    expect(within(panel).getByText("Sending…")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Edit comment/ })).not.toBeInTheDocument(); // no id yet
    expect(within(panel).queryByRole("button", { name: /Delete comment/ })).not.toBeInTheDocument();
    expect(api.comments.create).toHaveBeenCalledWith("t1", { content: "Yes, I'll handle it." });

    d.resolve({ comment: makeComment("c9", "u1", "Vivek Kumar", "Yes, I'll handle it.", { createdAt: new Date().toISOString() }) });
    await waitFor(() => expect(within(panel).queryByText("Sending…")).not.toBeInTheDocument());
    expect(within(panel).getByText("Just now")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Edit comment by Vivek Kumar" })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Comments (1)" })).toBeInTheDocument();
  });

  it("sends with Ctrl+Enter", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    api.comments.create.mockResolvedValueOnce({ comment: makeComment("c9", "u1", "Vivek Kumar", "Quick one") });
    await userEvent.type(composer(), "Quick one");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(api.comments.create).toHaveBeenCalledWith("t1", { content: "Quick one" }));
  });

  it("can't send an empty comment", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    expect(within(panel).getByRole("button", { name: "Comment" })).toBeDisabled();
    await userEvent.type(composer(), "   ");
    expect(within(panel).getByRole("button", { name: "Comment" })).toBeDisabled();
  });

  it("when posting fails the comment disappears, the text comes back, and the user is told", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    api.comments.create.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await userEvent.type(composer(), "Important thoughts");
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));

    expect(await within(panel).findByText("Something went wrong")).toBeInTheDocument();
    expect(composer()).toHaveValue("Important thoughts"); // nothing lost
    expect(within(panel).queryByText("Sending…")).not.toBeInTheDocument();
    expect(within(panel).getByText("No comments yet.")).toBeInTheDocument();

    api.comments.create.mockResolvedValueOnce({ comment: makeComment("c9", "u1", "Vivek Kumar", "Important thoughts") });
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(within(panel).queryByText("Something went wrong")).not.toBeInTheDocument());
  });
});

describe("editing and deleting", () => {
  const mine = () => makeComment("c1", "u1", "Vivek Kumar", "Original text");
  const hers = () => makeComment("c2", "u2", "Mia Member", "Her comment");

  it("edits my own comment: pre-filled editor, instant update, marked edited", async () => {
    api.comments.list.mockResolvedValue({ comments: [mine()] });
    const panel = await openPanel();
    api.comments.update.mockResolvedValueOnce({ comment: makeComment("c1", "u1", "Vivek Kumar", "Better text", { edited: true, updatedAt: new Date(Date.now() + 1000).toISOString() }) });

    await userEvent.click(await within(panel).findByRole("button", { name: "Edit comment by Vivek Kumar" }));
    const box = within(panel).getByLabelText("Edit comment");
    expect(box).toHaveValue("Original text");
    await userEvent.clear(box);
    await userEvent.type(box, "Better text");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    expect(await within(panel).findByText("Better text")).toBeInTheDocument();
    expect(within(panel).getByText(/edited/)).toBeInTheDocument();
    expect(api.comments.update).toHaveBeenCalledWith("c1", { content: "Better text" });
  });

  it("Escape cancels the edit without closing the panel; Cancel does the same", async () => {
    api.comments.list.mockResolvedValue({ comments: [mine()] });
    const panel = await openPanel();
    await userEvent.click(await within(panel).findByRole("button", { name: "Edit comment by Vivek Kumar" }));
    await userEvent.type(within(panel).getByLabelText("Edit comment"), " more");
    await userEvent.keyboard("{Escape}");
    expect(within(panel).queryByLabelText("Edit comment")).not.toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(within(panel).getByText("Original text")).toBeInTheDocument();
    expect(api.comments.update).not.toHaveBeenCalled();

    await userEvent.click(within(panel).getByRole("button", { name: "Edit comment by Vivek Kumar" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(within(panel).queryByLabelText("Edit comment")).not.toBeInTheDocument();
  });

  it("a rejected edit rolls back and shows a toast", async () => {
    api.comments.list.mockResolvedValue({ comments: [mine()] });
    const panel = await openPanel();
    api.comments.update.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await userEvent.click(await within(panel).findByRole("button", { name: "Edit comment by Vivek Kumar" }));
    const box = within(panel).getByLabelText("Edit comment");
    await userEvent.clear(box);
    await userEvent.type(box, "Doomed edit");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument(); // toast
    await waitFor(() => expect(within(panel).getByText("Original text")).toBeInTheDocument());
    expect(within(panel).queryByText("Doomed edit")).not.toBeInTheDocument();
  });

  it("deletes my own comment at once, and brings it back with a toast if the server refuses", async () => {
    api.comments.list.mockResolvedValue({ comments: [mine()] });
    const panel = await openPanel();
    const d = deferred();
    api.comments.delete.mockReturnValueOnce(d.promise);
    await userEvent.click(await within(panel).findByRole("button", { name: "Delete comment by Vivek Kumar" }));
    expect(within(panel).queryByText("Original text")).not.toBeInTheDocument();

    d.reject(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    expect(await within(panel).findByText("Original text")).toBeInTheDocument();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("MEMBER: can edit and delete only their own comments", async () => {
    useAuthStore.setState({ user: { ...ME, id: "u2", name: "Mia Member" } });
    api.comments.list.mockResolvedValue({ comments: [mine(), hers()] });
    const panel = await openPanel({ role: "MEMBER", permissions: MEMBER_PERMISSIONS });
    await within(panel).findByText("Her comment");

    expect(within(panel).getByRole("button", { name: "Edit comment by Mia Member" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Delete comment by Mia Member" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /by Vivek Kumar/ })).not.toBeInTheDocument();
  });

  it("ADMIN/OWNER: can delete other people's comments (moderation) but still can't edit them", async () => {
    api.comments.list.mockResolvedValue({ comments: [hers()] });
    const panel = await openPanel({ role: "ADMIN", permissions: ADMIN_PERMISSIONS });
    await within(panel).findByText("Her comment");
    expect(within(panel).getByRole("button", { name: "Delete comment by Mia Member" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Edit comment by Mia Member" })).not.toBeInTheDocument();
  });

  it("VIEWER: can read, but has no composer and no edit or delete buttons on other people's comments", async () => {
    api.comments.list.mockResolvedValue({ comments: [hers()] });
    const panel = await openPanel({ role: "VIEWER", permissions: VIEWER_PERMISSIONS });
    expect(await within(panel).findByText("Her comment")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Write a comment")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Edit comment|Delete comment/ })).not.toBeInTheDocument();
  });

  it("an author who has since become a VIEWER may still delete (not edit) their own old comment", async () => {
    api.comments.list.mockResolvedValue({ comments: [mine()] });
    const panel = await openPanel({ role: "VIEWER", permissions: VIEWER_PERMISSIONS });
    await within(panel).findByText("Original text");
    expect(within(panel).getByRole("button", { name: "Delete comment by Vivek Kumar" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Edit comment/ })).not.toBeInTheDocument();
  });
});

describe("unsent comment draft and cleanup", () => {
  it("an unsent comment is treated as unsaved work when closing the panel", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    await userEvent.type(composer(), "half-written thought");

    await userEvent.keyboard("{Escape}");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/unsent comment/i);
    expect(dialog()).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.comments.create).not.toHaveBeenCalled();
  });

  it("once the comment is sent there is nothing to warn about", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    api.comments.create.mockResolvedValueOnce({ comment: makeComment("c9", "u1", "Vivek Kumar", "sent") });
    await userEvent.type(composer(), "sent");
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));
    await within(panel).findByText("sent");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("after sending, focus returns to the composer so the keyboard isn't stranded on the disabled button", async () => {
    const panel = await openPanel();
    await within(panel).findByText("No comments yet.");
    api.comments.create.mockResolvedValueOnce({ comment: makeComment("c9", "u1", "Vivek Kumar", "hello") });
    await userEvent.type(composer(), "hello");
    await userEvent.click(within(panel).getByRole("button", { name: "Comment" }));
    await within(panel).findByText("hello");
    expect(composer()).toHaveFocus();
  });

  it("closing the panel discards the loaded comments", async () => {
    api.comments.list.mockResolvedValue({ comments: [makeComment("c1", "u2", "Mia Member", "hello")] });
    const panel = await openPanel();
    await within(panel).findByText("hello");
    await userEvent.keyboard("{Escape}");
    expect(useCommentStore.getState()).toMatchObject({ taskId: null, comments: [], status: "idle" });
  });
});
