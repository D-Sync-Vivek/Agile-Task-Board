// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import Toaster from "@/components/ui/Toaster";
import { ApiError } from "@/lib/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { useToastStore } from "@/store/useToastStore";
import type { BoardMemberDto } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { VIEWER_PERMISSIONS, apiError, deferred, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";
import { nav, resetNav } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const NOW = "2026-10-04T10:00:00.000Z";
const member = (id: string, userId: string, name: string, role: BoardMemberDto["role"]): BoardMemberDto => ({
  id, userId, role, createdAt: NOW, user: { id: userId, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, avatar: null },
});
const MEMBERS = [member("m1", "u1", "Vivek Kumar", "OWNER"), member("m2", "u2", "Mia Member", "MEMBER")];

const detailedTask = () => ({
  ...makeTask("t1", "c1", "Implement authentication", 0),
  description: "Add JWT authentication",
  priority: "HIGH" as const,
  assigneeId: "u2",
  dueDate: "2026-10-15",
  createdById: "u1",
});

function boardWith(overrides: Parameters<typeof makeBoard>[0] = {}) {
  return makeBoard({
    members: MEMBERS,
    columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1)],
    tasks: [detailedTask(), makeTask("t2", "c1", "Plain task", 1), makeTask("t3", "c2", "Review", 0)],
    ...overrides,
  });
}

beforeEach(() => {
  resetApiMock();
  resetNav();
  nav.params = { boardId: "b1" };
  nav.pathname = "/boards/b1";
  useBoardStore.getState().reset();
  useTaskPanelStore.getState().close();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: MEMBERS[0].user as never });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.comments.list.mockResolvedValue({ comments: [] }); // opening the panel loads the task's comments
});

async function ready(board = boardWith()) {
  api.boards.get.mockResolvedValueOnce({ board });
  const view = render(
    <>
      <BoardPage />
      <Toaster />
    </>
  );
  await screen.findByText("Review");
  return view;
}

const openTask = async (title: string) => {
  await userEvent.click(screen.getByText(title));
  return screen.findByRole("dialog", { name: "Task details" });
};
const dialog = () => screen.getByRole("dialog", { name: "Task details" });
const saved = (over: object = {}) => ({ task: { ...detailedTask(), updatedAt: "2026-10-05T12:00:00.000Z", ...over } });

describe("opening the panel", () => {
  it("clicking a card shows every detail of the task", async () => {
    await ready();
    const panel = await openTask("Implement authentication");

    expect(within(panel).getByLabelText("Title")).toHaveValue("Implement authentication");
    expect(within(panel).getByLabelText("Description")).toHaveValue("Add JWT authentication");
    expect(within(panel).getByLabelText("Priority")).toHaveValue("HIGH");
    expect(within(panel).getByLabelText("Due date")).toHaveValue("2026-10-15");
    expect(within(panel).getByLabelText("Assignee")).toHaveValue("u2");
    expect(within(panel).getByRole("option", { name: "Mia Member" })).toBeInTheDocument();
    expect(within(panel).getByText("Created by").parentElement).toHaveTextContent("Vivek Kumar");
    expect(within(panel).getByText("Created")).toBeInTheDocument();
    expect(within(panel).getByText("Last updated")).toBeInTheDocument();
    expect(within(panel).getAllByText(/2026/).length).toBeGreaterThanOrEqual(2);
  });

  it("is a labelled modal dialog and moves focus inside", async () => {
    await ready();
    const panel = await openTask("Plain task");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("opens from the keyboard-reachable Details button without starting a drag", async () => {
    await ready();
    const button = screen.getByRole("button", { name: "Open details for Plain task" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
  });

  it("the keyboard works on the card's delete button too (Enter deletes; it doesn't start a drag)", async () => {
    await ready();
    api.tasks.delete.mockResolvedValueOnce(null);
    const card = screen.getByText("Plain task").closest("div.task") as HTMLElement;
    within(card).getByRole("button", { name: "Delete task" }).focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(api.tasks.delete).toHaveBeenCalledWith("t2"));
  });

  it("clicking the delete icon deletes without opening the panel", async () => {
    await ready();
    api.tasks.delete.mockResolvedValueOnce(null);
    const card = screen.getByText("Plain task").closest("div.task") as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "Delete task" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(api.tasks.delete).toHaveBeenCalledWith("t2"));
  });

  it("shows each task's own values and never leaks edits between tasks", async () => {
    await ready();
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), " (draft)");
    await userEvent.click(screen.getByRole("button", { name: "Close task details" }));
    await userEvent.click(screen.getByRole("button", { name: "Close task details" })); // discard

    const second = await openTask("Plain task");
    expect(within(second).getByLabelText("Title")).toHaveValue("Plain task");
    expect(within(second).getByLabelText("Assignee")).toHaveValue("");
    expect(within(second).getByLabelText("Priority")).toHaveValue("MEDIUM");
  });
});

describe("editing", () => {
  it("saves only the changed fields, shows 'Saved', and updates the card", async () => {
    await ready();
    api.tasks.update.mockResolvedValueOnce(saved({ title: "Add login", priority: "URGENT" }));
    await openTask("Implement authentication");

    const title = within(dialog()).getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "  Add login  ");
    await userEvent.selectOptions(within(dialog()).getByLabelText("Priority"), "URGENT");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));

    expect(api.tasks.update).toHaveBeenCalledWith("t1", { title: "Add login", priority: "URGENT" });
    expect(api.tasks.assign).not.toHaveBeenCalled();
    expect(await within(dialog()).findByText("Saved")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("Add login"); // trimmed
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing left to save
    expect(screen.getAllByText("Add login").length).toBeGreaterThan(0); // the card behind the panel
  });

  it("changes and clears the assignee", async () => {
    await ready();
    api.tasks.assign.mockResolvedValueOnce(saved({ assigneeId: "u1" }));
    await openTask("Implement authentication");
    await userEvent.selectOptions(within(dialog()).getByLabelText("Assignee"), "u1");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.tasks.assign).toHaveBeenLastCalledWith("t1", "u1"));
    expect(api.tasks.update).not.toHaveBeenCalled();

    api.tasks.assign.mockResolvedValueOnce(saved({ assigneeId: null }));
    await userEvent.selectOptions(within(dialog()).getByLabelText("Assignee"), "");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.tasks.assign).toHaveBeenLastCalledWith("t1", null));
  });

  it("sets and clears the due date and the description", async () => {
    await ready();
    api.tasks.update.mockResolvedValueOnce(saved({ dueDate: "2026-12-01" }));
    await openTask("Implement authentication");
    fireEvent.change(within(dialog()).getByLabelText("Due date"), { target: { value: "2026-12-01" } });
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.tasks.update).toHaveBeenLastCalledWith("t1", { dueDate: "2026-12-01" }));

    api.tasks.update.mockResolvedValueOnce(saved({ dueDate: null, description: null }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Clear due date" }));
    await userEvent.clear(within(dialog()).getByLabelText("Description"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.tasks.update).toHaveBeenLastCalledWith("t1", { dueDate: null, description: null }));
  });

  it("save is disabled until something changes, and Reset restores the saved values", async () => {
    await ready();
    await openTask("Implement authentication");
    const save = within(dialog()).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog()).getByLabelText("Title"), "!");
    expect(save).toBeEnabled();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Reset" }));
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("Implement authentication");
    expect(save).toBeDisabled();
    expect(api.tasks.update).not.toHaveBeenCalled();
  });

  it("shows a pending state and blocks double submission", async () => {
    await ready();
    const d = deferred();
    api.tasks.update.mockReturnValueOnce(d.promise);
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), "!");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    expect(within(dialog()).getByRole("button", { name: "Saving…" })).toBeDisabled();

    d.resolve(saved({ title: "Implement authentication!" }));
    expect(await within(dialog()).findByText("Saved")).toBeInTheDocument();
    expect(api.tasks.update).toHaveBeenCalledTimes(1);
  });
});

describe("validation and errors", () => {
  it("a blank title is rejected on the client without calling the API", async () => {
    await ready();
    await openTask("Implement authentication");
    await userEvent.clear(within(dialog()).getByLabelText("Title"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog()).findByText("Title is required")).toBeInTheDocument();
    expect(api.tasks.update).not.toHaveBeenCalled();
  });

  it("shows the server's field-level messages next to the fields", async () => {
    await ready();
    api.tasks.update.mockRejectedValueOnce(
      new ApiError(422, "VALIDATION_ERROR", "Invalid request data", [
        { field: "title", message: "Task title must be at most 200 characters" },
        { field: "dueDate", message: "Not a valid calendar date" },
      ])
    );
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), "!");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog()).findByText("Task title must be at most 200 characters")).toBeInTheDocument();
    expect(within(dialog()).getByText("Not a valid calendar date")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument(); // field errors, no generic banner
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeEnabled(); // can fix and retry
  });

  it("shows an invalid-assignee error under the assignee field", async () => {
    await ready();
    api.tasks.assign.mockRejectedValueOnce(apiError(422, "INVALID_ASSIGNEE", "Assignee must be a member of this board"));
    await openTask("Implement authentication");
    await userEvent.selectOptions(within(dialog()).getByLabelText("Assignee"), "u1");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog()).findByText("Assignee must be a member of this board")).toBeInTheDocument();
  });

  it("shows other failures in an alert, keeps what was typed, and lets the user retry", async () => {
    await ready();
    api.tasks.update.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Something went wrong"));
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), " v2");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("Implement authentication v2");

    api.tasks.update.mockResolvedValueOnce(saved({ title: "Implement authentication v2" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog()).findByText("Saved")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("closing", () => {
  it("closes immediately when nothing changed: Escape, the × button and the backdrop", async () => {
    const { container } = await ready();
    await openTask("Plain task");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openTask("Plain task");
    await userEvent.click(screen.getByRole("button", { name: "Close task details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openTask("Plain task");
    await userEvent.click(container.querySelector('[aria-hidden="true"].absolute') as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("with unsaved changes the first attempt warns and the second discards", async () => {
    await ready();
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), "!");

    await userEvent.keyboard("{Escape}");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/unsaved changes/i);
    expect(dialog()).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.tasks.update).not.toHaveBeenCalled();
  });

  it("the unsaved-changes warning goes away once the user keeps editing", async () => {
    await ready();
    await openTask("Implement authentication");
    await userEvent.type(within(dialog()).getByLabelText("Title"), "!");
    await userEvent.keyboard("{Escape}");
    expect(within(dialog()).getByRole("alert")).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByLabelText("Title"), "?");
    expect(within(dialog()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns focus to where it was before opening", async () => {
    await ready();
    const details = screen.getByRole("button", { name: "Open details for Plain task" });
    details.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Task details" });
    await userEvent.keyboard("{Escape}");
    expect(details).toHaveFocus();
  });

  it("Escape still closes the panel right after saving (the focused Save button has just disabled itself)", async () => {
    await ready();
    api.tasks.update.mockResolvedValueOnce(saved({ title: "Add login" }));
    await openTask("Implement authentication");
    await userEvent.clear(within(dialog()).getByLabelText("Title"));
    await userEvent.type(within(dialog()).getByLabelText("Title"), "Add login");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save changes" }));
    await within(dialog()).findByText("Saved");
    expect(within(dialog()).getByRole("button", { name: "Save changes" })).toBeDisabled();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Tab brings focus back into the dialog if it ended up outside it", async () => {
    await ready();
    await openTask("Implement authentication");
    (document.activeElement as HTMLElement).blur(); // focus falls to <body>
    expect(dialog().contains(document.activeElement)).toBe(false);
    await userEvent.tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog (wraps in both directions)", async () => {
    await ready();
    await openTask("Implement authentication");
    const focusable = Array.from(dialog().querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it("closes by itself when the task disappears (deleted elsewhere / board re-synced)", async () => {
    await ready();
    await openTask("Implement authentication");
    useBoardStore.setState((s) => ({ tasks: s.tasks.filter((t) => t.id !== "t1") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useTaskPanelStore.getState().taskId).toBeNull();
  });

  it("is closed when leaving the board", async () => {
    const { unmount } = await ready();
    await openTask("Plain task");
    unmount();
    expect(useTaskPanelStore.getState().taskId).toBeNull();
  });
});

describe("read-only view (no task:update permission)", () => {
  const viewerBoard = () => boardWith({ myRole: "VIEWER", myPermissions: VIEWER_PERMISSIONS });

  it("shows the values as text, with no inputs and no Save button", async () => {
    await ready(viewerBoard());
    const panel = await openTask("Implement authentication");

    expect(within(panel).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(within(panel).getByText("Add JWT authentication")).toBeInTheDocument();
    expect(within(panel).getByText("High")).toBeInTheDocument();
    expect(within(panel).getByText("Oct 15, 2026")).toBeInTheDocument();
    expect(within(panel).getByText("Mia Member")).toBeInTheDocument();
  });

  it("says so when optional fields are empty", async () => {
    await ready(viewerBoard());
    const panel = await openTask("Plain task");
    expect(within(panel).getByText("No description")).toBeInTheDocument();
    expect(within(panel).getByText("No due date")).toBeInTheDocument();
    expect(within(panel).getByText("Unassigned")).toBeInTheDocument();
  });

  it("can still be closed without any warning", async () => {
    await ready(viewerBoard());
    await openTask("Plain task");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("people who are no longer on the board", () => {
  it("labels a former member as the creator and keeps them selectable as the current assignee", async () => {
    const task = { ...detailedTask(), createdById: "u9", assigneeId: "u9" };
    await ready(boardWith({ tasks: [task, makeTask("t3", "c2", "Review", 0)] }));
    const panel = await openTask("Implement authentication");

    expect(within(panel).getAllByText("Former member").length).toBeGreaterThanOrEqual(2); // created by + select option
    expect(within(panel).getByLabelText("Assignee")).toHaveValue("u9");
    expect(within(panel).getByRole("button", { name: "Save changes" })).toBeDisabled(); // not dirty just because of that
  });
});
