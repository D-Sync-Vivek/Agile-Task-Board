// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BoardPage from "@/app/boards/[boardId]/page";
import { useBoardRealtime } from "@/hooks/useBoardRealtime";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardActivityStore, useTaskActivityStore } from "@/store/useActivityStores";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useRealtimeStore } from "@/store/useRealtimeStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { useToastStore } from "@/store/useToastStore";
import type { BoardMemberDto, BoardRole } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { fake } from "../helpers/fakeSocket";
import { apiError, makeActivity, makeBoard, makeColumn, makeComment, makeTask } from "../helpers/fixtures";
import { nav, resetNav, router } from "../helpers/nav";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));
vi.mock("next/navigation", () => import("../helpers/nav"));

const NOW = "2026-10-04T10:00:00.000Z";
const ME = { id: "u1", name: "Vivek Kumar", email: "u1@example.com", avatar: null, createdAt: NOW };
const member = (id: string, userId: string, name: string, role: BoardRole = "MEMBER"): BoardMemberDto => ({ id, userId, role, createdAt: NOW, user: { id: userId, name, email: `${userId}@example.com`, avatar: null } });
const MEMBERS = [member("m1", "u1", "Vivek Kumar", "OWNER"), member("m2", "u2", "Mia Member")];
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

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
  useRealtimeStore.setState({ status: "idle" });
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({ status: "authenticated", user: ME });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  api.comments.list.mockResolvedValue({ comments: [] });
});

const boardOf = (over: Parameters<typeof makeBoard>[0] = {}) =>
  makeBoard({ members: MEMBERS, columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1)], tasks: [makeTask("t1", "c1", "Authentication", 0)], ...over });

/** Opens the board page and brings the live connection up (as the browser would after connecting). */
async function openLive(board = boardOf()) {
  api.boards.get.mockResolvedValue({ board });
  render(<BoardPage />);
  await screen.findByText("Authentication");
  await act(async () => {
    await fake.current.simulateConnect();
  });
}
const server = (event: string, payload?: unknown) => act(() => fake.current.serverEmit(event, payload));

describe("connection lifecycle", () => {
  it("connects, joins this board's room, and shows Live", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    expect(fake.all).toHaveLength(1);
    expect(await screen.findByText("Connecting…")).toBeInTheDocument();

    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(fake.current.sent).toEqual([{ event: "board:join", payload: { boardId: "b1" } }]);
    expect(await screen.findByText("Live")).toBeInTheDocument();
  });

  it("re-reads the board after joining (changes made between page load and join would otherwise be missed)", async () => {
    await openLive();
    expect(api.boards.get).toHaveBeenCalledTimes(2);
  });

  it("shows Reconnecting… when the connection drops, and on reconnect rejoins and re-reads everything on screen", async () => {
    await openLive();
    await server("disconnect", "transport close");
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();

    api.boards.get.mockClear();
    await act(async () => {
      await fake.current.simulateConnect(); // a NEW connection: in no rooms until it joins again
    });
    expect(fake.current.sent.filter((s) => s.event === "board:join")).toHaveLength(2);
    expect(api.boards.get).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Live")).toBeInTheDocument();
  });

  it("recovers from a join that never gets an answer by reconnecting", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    fake.current.joinHangs = true;
    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
    expect(fake.current.connectCalls).toBe(1);
  });

  it("a refused join (access revoked) shows Not live and re-checks the board", async () => {
    api.boards.get.mockResolvedValueOnce({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    fake.current.joinAck = { ok: false, error: { code: "BOARD_NOT_FOUND", message: "Board not found" } };
    api.boards.get.mockRejectedValueOnce(apiError(404, "BOARD_NOT_FOUND", "Board not found"));
    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(await screen.findByText("Board not found.")).toBeInTheDocument();
    expect(useRealtimeStore.getState().status).toBe("offline");
  });

  it("an expired session signs the user out locally, and the page then tears the connection down", async () => {
    await openLive();
    const socket = fake.current;
    await server("disconnect", "io server disconnect"); // the server ended it: the client would NOT retry on its own
    expect(useAuthStore.getState().status).toBe("anonymous");
    await waitFor(() => expect(socket.closed).toBe(true)); // leaving for the login page: no zombie connection
    expect(socket.listenerCount()).toBe(0);
  });

  it("an unauthenticated handshake signs the user out; network trouble just keeps retrying", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    render(<BoardPage />);
    await screen.findByText("Authentication");
    await server("connect_error", new Error("xhr poll error"));
    expect(useRealtimeStore.getState().status).toBe("reconnecting");
    expect(useAuthStore.getState().status).toBe("authenticated");
    fake.current.simulateConnectError("UNAUTHORIZED");
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("does not connect when disabled (not signed in)", () => {
    renderHook(() => useBoardRealtime("b1", false));
    expect(fake.all).toHaveLength(0);
  });

  it("leaving the board closes the connection, removes every listener, and ignores later events", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    const view = render(<BoardPage />);
    await screen.findByText("Authentication");
    const socket = fake.current;
    await act(async () => {
      await socket.simulateConnect();
    });
    expect(socket.listenerCount()).toBeGreaterThan(10);

    view.unmount();
    expect(socket.closed).toBe(true);
    expect(socket.listenerCount()).toBe(0);
    expect(useRealtimeStore.getState().status).toBe("idle");

    socket.serverEmit("task:deleted", { taskId: "t1", actorId: "u2" }); // nobody is listening any more
    expect(useBoardStore.getState().tasks.map((t) => t.id)).toEqual(["t1"]);
  });

  it("opening another board uses a fresh connection and the old one is closed", async () => {
    api.boards.get.mockResolvedValue({ board: boardOf() });
    const view = render(<BoardPage />);
    await screen.findByText("Authentication");
    const first = fake.current;
    nav.params = { boardId: "b2" };
    api.boards.get.mockResolvedValue({ board: boardOf({ id: "b2", name: "Other", tasks: [makeTask("x1", "c1", "Elsewhere", 0)] }) });
    view.rerender(<BoardPage />);
    await screen.findByText("Elsewhere");
    expect(first.closed).toBe(true);
    expect(fake.all).toHaveLength(2);
    await act(async () => {
      await fake.current.simulateConnect();
    });
    expect(fake.current.sent[0].payload).toEqual({ boardId: "b2" });
  });
});

describe("live changes by other people", () => {
  it("a created, edited, moved and deleted task appear on screen without any action", async () => {
    await openLive();
    await server("task:created", { task: makeTask("t2", "c1", "Brand new", 1), actorId: "u2" });
    expect(await screen.findByText("Brand new")).toBeInTheDocument();

    await server("task:updated", { task: { ...makeTask("t2", "c1", "Brand new, renamed", 1), updatedAt: "2026-10-05T00:00:00.000Z" }, actorId: "u2" });
    expect(await screen.findByText("Brand new, renamed")).toBeInTheDocument();

    await server("task:moved", { task: makeTask("t2", "c2", "Brand new, renamed", 0), columns: [{ columnId: "c1", taskIds: ["t1"] }, { columnId: "c2", taskIds: ["t2"] }], actorId: "u2" });
    expect(useBoardStore.getState().tasks.find((t) => t.id === "t2")?.columnId).toBe("c2");

    await server("task:deleted", { taskId: "t2", actorId: "u2" });
    await waitFor(() => expect(screen.queryByText("Brand new, renamed")).not.toBeInTheDocument());
  });

  it("columns appear, get renamed, reorder and disappear", async () => {
    await openLive();
    await server("column:created", { column: makeColumn("c3", "Review", 2), actorId: "u2" });
    expect(await screen.findByText("Review")).toBeInTheDocument();
    await server("column:updated", { column: makeColumn("c3", "In Review", 2), actorId: "u2" });
    expect(await screen.findByText("In Review")).toBeInTheDocument();
    await server("column:reordered", { columns: [makeColumn("c3", "In Review", 0), makeColumn("c1", "Todo", 1), makeColumn("c2", "Doing", 2)], actorId: "u2" });
    expect(useBoardStore.getState().columns.map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
    await server("column:deleted", { columnId: "c3", actorId: "u2" });
    await waitFor(() => expect(screen.queryByText("In Review")).not.toBeInTheDocument());
  });

  it("a renamed board updates the header", async () => {
    await openLive();
    await server("board:updated", { board: { name: "Sprint 12", description: null }, actorId: "u2" });
    expect(await screen.findByRole("heading", { name: "Sprint 12" })).toBeInTheDocument();
  });

  it("a task deleted while its panel is open closes the panel and says who did it", async () => {
    await openLive();
    await userEvent.click(screen.getByText("Authentication"));
    await screen.findByRole("dialog", { name: "Task details" });
    await server("task:deleted", { taskId: "t1", actorId: "u2" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toasts()).toContain("Mia Member deleted this task.");
  });

  it("members: someone added, someone's role changed, someone removed", async () => {
    await openLive();
    await server("member:added", { member: member("m3", "u3", "Rahul"), actorId: "u1" });
    await server("member:updated", { member: { ...member("m3", "u3", "Rahul"), role: "ADMIN" }, actorId: "u1" });
    expect(useBoardStore.getState().board!.members.find((m) => m.id === "m3")?.role).toBe("ADMIN");
    await server("member:removed", { memberId: "m3", userId: "u3", actorId: "u1" });
    expect(useBoardStore.getState().board!.members.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("when MY role changes, I'm told and the board is re-read for the new permissions", async () => {
    await openLive();
    api.boards.get.mockClear();
    api.boards.get.mockResolvedValue({ board: boardOf({ myRole: "VIEWER", myPermissions: ["board:view"] }) });
    await server("member:updated", { member: { ...member("m1", "u1", "Vivek Kumar"), role: "VIEWER" }, actorId: "u2" });
    expect(toasts()).toContain("Your role on this board is now Viewer.");
    await waitFor(() => expect(useBoardStore.getState().board?.myRole).toBe("VIEWER"));
  });

  it("when I am removed, I'm told and sent back to my boards, with the board cleared", async () => {
    await openLive();
    await server("member:removed", { memberId: "m1", userId: "u1", actorId: "u2" });
    expect(toasts()).toContain("You were removed from this board.");
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(useBoardStore.getState().board).toBeNull();
  });

  it("when the board is deleted, everyone watching is told and sent back", async () => {
    await openLive();
    await server("board:deleted", { boardId: "b1", actorId: "u2" });
    expect(toasts()).toContain("This board was deleted.");
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});

describe("live activity and comments", () => {
  const created = (id: string, title = "New thing") =>
    makeActivity(id, { action: "TASK_CREATED", entityType: "TASK", metadata: { taskTitle: title, columnTitle: "Todo" } }, { entityId: "t1" });

  it("the open board-activity drawer gets new entries on top, once", async () => {
    api.activity.forBoard.mockResolvedValue({ activities: [created("a1", "Old one")], nextCursor: null });
    await openLive();
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    const drawer = await screen.findByRole("dialog", { name: "Board activity" });
    await within(drawer).findByText("created task “Old one” in Todo");

    await server("activity:created", { activity: created("a2", "Fresh") });
    await server("activity:created", { activity: created("a2", "Fresh") }); // duplicate delivery
    expect(await within(drawer).findByText("created task “Fresh” in Todo")).toBeInTheDocument();
    expect(within(drawer).getAllByRole("listitem")).toHaveLength(2);
    expect(within(drawer).getAllByRole("listitem")[0]).toHaveTextContent("Fresh");
  });

  it("the task panel's activity shows only entries about that task (and comments on it)", async () => {
    api.activity.forTask.mockResolvedValue({ activities: [], nextCursor: null });
    await openLive();
    await userEvent.click(screen.getByText("Authentication"));
    const panel = await screen.findByRole("dialog", { name: "Task details" });
    await within(panel).findByText("No activity yet.");

    await server("activity:created", { activity: created("a5", "Other task").entityId === "t1" ? makeActivity("a5", { action: "TASK_CREATED", entityType: "TASK", metadata: { taskTitle: "Other task", columnTitle: "Todo" } }, { entityId: "t999" }) : created("a5") });
    await server("activity:created", { activity: makeActivity("a6", { action: "COMMENT_ADDED", entityType: "COMMENT", metadata: { taskId: "t1", taskTitle: "Authentication" } }, { entityId: "c1" }) });
    expect(await within(panel).findByText("commented on “Authentication”")).toBeInTheDocument();
    expect(within(panel).queryByText(/Other task/)).not.toBeInTheDocument();
  });

  it("comments by others appear in the open panel, are edited and deleted live; other tasks' comments are ignored", async () => {
    await openLive();
    await userEvent.click(screen.getByText("Authentication"));
    const panel = await screen.findByRole("dialog", { name: "Task details" });
    await within(panel).findByText("No comments yet.");

    await server("comment:created", { comment: makeComment("c1", "u2", "Mia Member", "Looks good"), taskId: "t1", actorId: "u2" });
    expect(await within(panel).findByText("Looks good")).toBeInTheDocument();
    await server("comment:updated", { comment: makeComment("c1", "u2", "Mia Member", "Looks great", { edited: true }), taskId: "t1", actorId: "u2" });
    expect(await within(panel).findByText("Looks great")).toBeInTheDocument();
    await server("comment:created", { comment: makeComment("c9", "u2", "Mia Member", "Elsewhere", { taskId: "t2" }), taskId: "t2", actorId: "u2" });
    expect(within(panel).queryByText("Elsewhere")).not.toBeInTheDocument();
    await server("comment:deleted", { commentId: "c1", taskId: "t1", actorId: "u2" });
    await waitFor(() => expect(within(panel).queryByText("Looks great")).not.toBeInTheDocument());
  });
});

describe("editing a task while others edit it too", () => {
  async function openPanel() {
    await openLive();
    await userEvent.click(screen.getByText("Authentication"));
    return screen.findByRole("dialog", { name: "Task details" });
  }
  const remote = (over: Record<string, unknown>) => server("task:updated", { task: { ...makeTask("t1", "c1", "Authentication", 0), updatedAt: "2026-10-05T00:00:00.000Z", ...over }, actorId: "u2" });

  it("fields I haven't touched follow the other person's change", async () => {
    const panel = await openPanel();
    await remote({ priority: "URGENT", assigneeId: "u2" });
    expect(within(panel).getByLabelText("Priority")).toHaveValue("URGENT");
    expect(within(panel).getByLabelText("Assignee")).toHaveValue("u2");
    expect(within(panel).getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing of mine to save
  });

  it("my edit is kept, and saving sends ONLY my edit: their change to another field is not overwritten", async () => {
    const panel = await openPanel();
    await userEvent.clear(within(panel).getByLabelText("Title"));
    await userEvent.type(within(panel).getByLabelText("Title"), "My title");

    await remote({ priority: "URGENT" }); // someone else changes a different field meanwhile
    expect(within(panel).getByLabelText("Title")).toHaveValue("My title");
    expect(within(panel).getByLabelText("Priority")).toHaveValue("URGENT");
    expect(within(panel).queryByText(/Someone else changed/)).not.toBeInTheDocument(); // no clash

    api.tasks.update.mockResolvedValue({ task: { ...makeTask("t1", "c1", "My title", 0), priority: "URGENT", updatedAt: "2026-10-06T00:00:00.000Z" } });
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(api.tasks.update).toHaveBeenCalledWith("t1", { title: "My title" }); // NOT priority
  });

  it("when we both changed the same field, I'm warned, my value is kept, and Reset takes theirs", async () => {
    const panel = await openPanel();
    await userEvent.clear(within(panel).getByLabelText("Title"));
    await userEvent.type(within(panel).getByLabelText("Title"), "Mine");

    await remote({ title: "Theirs" });
    expect(await within(panel).findByText(/Someone else changed Title while you were editing/)).toBeInTheDocument();
    expect(within(panel).getByLabelText("Title")).toHaveValue("Mine");

    await userEvent.click(within(panel).getByRole("button", { name: "Reset" }));
    expect(within(panel).getByLabelText("Title")).toHaveValue("Theirs");
    expect(within(panel).queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("no false alarm when the other person made the same edit I did", async () => {
    const panel = await openPanel();
    await userEvent.selectOptions(within(panel).getByLabelText("Priority"), "HIGH");
    await remote({ priority: "HIGH" });
    expect(within(panel).queryByText(/Someone else changed/)).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Save changes" })).toBeDisabled(); // already equal: nothing to save
  });

  it("my own save doesn't trigger a conflict warning", async () => {
    const panel = await openPanel();
    await userEvent.selectOptions(within(panel).getByLabelText("Priority"), "LOW");
    api.tasks.update.mockResolvedValue({ task: { ...makeTask("t1", "c1", "Authentication", 0), priority: "LOW", updatedAt: "2026-10-06T00:00:00.000Z" } });
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));
    expect(await within(panel).findByText("Saved")).toBeInTheDocument();
    expect(within(panel).queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });
});
