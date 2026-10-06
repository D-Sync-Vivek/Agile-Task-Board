import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const store = () => useBoardStore.getState();
const task = (id: string) => store().tasks.find((t) => t.id === id)!;
const LATER = "2026-10-05T12:00:00.000Z";

beforeEach(async () => {
  resetApiMock();
  store().reset();
  useAuthStore.setState({ status: "authenticated", user: null });
  api.boards.get.mockResolvedValueOnce({
    board: makeBoard({
      columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1)],
      tasks: [makeTask("t1", "c1", "Write tests", 0), makeTask("t2", "c1", "Ship it", 1), makeTask("t3", "c2", "Review", 0)],
    }),
  });
  await store().loadBoard("b1");
});

describe("updateTaskDetails", () => {
  it("content fields only: one PATCH, no assign call, merged into the store without moving the task", async () => {
    api.tasks.update.mockResolvedValueOnce({ task: { ...makeTask("t1", "c9", "Better title", 7), description: "More", priority: "HIGH", dueDate: "2026-10-15", updatedAt: LATER } });
    await store().updateTaskDetails("t1", { title: "Better title", description: "More", priority: "HIGH", dueDate: "2026-10-15" });

    expect(api.tasks.update).toHaveBeenCalledWith("t1", { title: "Better title", description: "More", priority: "HIGH", dueDate: "2026-10-15" });
    expect(api.tasks.assign).not.toHaveBeenCalled();
    expect(task("t1")).toMatchObject({ title: "Better title", description: "More", priority: "HIGH", dueDate: "2026-10-15", updatedAt: LATER });
    expect(task("t1")).toMatchObject({ columnId: "c1", position: 0 }); // placement is not taken from the response
  });

  it("assignee only: one assign call, no update call", async () => {
    api.tasks.assign.mockResolvedValueOnce({ task: { ...makeTask("t1", "c1", "Write tests", 0), assigneeId: "u2", updatedAt: LATER } });
    await store().updateTaskDetails("t1", { assigneeId: "u2" });
    expect(api.tasks.assign).toHaveBeenCalledWith("t1", "u2");
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(task("t1")).toMatchObject({ assigneeId: "u2", updatedAt: LATER });
  });

  it("passes null through to clear a description, due date or assignee", async () => {
    api.tasks.update.mockResolvedValueOnce({ task: makeTask("t1", "c1", "Write tests", 0) });
    api.tasks.assign.mockResolvedValueOnce({ task: makeTask("t1", "c1", "Write tests", 0) });
    await store().updateTaskDetails("t1", { description: null, dueDate: null, assigneeId: null });
    expect(api.tasks.update).toHaveBeenCalledWith("t1", { description: null, dueDate: null });
    expect(api.tasks.assign).toHaveBeenCalledWith("t1", null);
  });

  it("both: saves content first, then the assignee", async () => {
    const calls: string[] = [];
    api.tasks.update.mockImplementationOnce(async () => (calls.push("update"), { task: { ...makeTask("t1", "c1", "New", 0), updatedAt: LATER } }));
    api.tasks.assign.mockImplementationOnce(async () => (calls.push("assign"), { task: { ...makeTask("t1", "c1", "New", 0), assigneeId: "u2", updatedAt: LATER } }));
    await store().updateTaskDetails("t1", { title: "New", assigneeId: "u2" });
    expect(calls).toEqual(["update", "assign"]);
    expect(task("t1")).toMatchObject({ title: "New", assigneeId: "u2" });
  });

  it("does nothing for no changes, an unknown task, or no board", async () => {
    await store().updateTaskDetails("t1", {});
    await store().updateTaskDetails("nope", { title: "x" });
    store().reset();
    await store().updateTaskDetails("t1", { title: "x" });
    expect(api.tasks.update).not.toHaveBeenCalled();
    expect(api.tasks.assign).not.toHaveBeenCalled();
  });

  it("a failed update throws the ApiError and leaves the task untouched (no optimistic change to undo)", async () => {
    api.tasks.update.mockRejectedValueOnce(apiError(422, "VALIDATION_ERROR", "Invalid request data"));
    await expect(store().updateTaskDetails("t1", { title: "x".repeat(300) })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(task("t1").title).toBe("Write tests");
    expect(api.boards.get).toHaveBeenCalledTimes(1); // a validation error doesn't force a resync
  });

  it("if the assignee step fails, the content step stays applied and the error is thrown", async () => {
    api.tasks.update.mockResolvedValueOnce({ task: { ...makeTask("t1", "c1", "New", 0), updatedAt: LATER } });
    api.tasks.assign.mockRejectedValueOnce(apiError(422, "INVALID_ASSIGNEE", "Assignee must be a member of this board"));
    await expect(store().updateTaskDetails("t1", { title: "New", assigneeId: "u9" })).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
    expect(task("t1")).toMatchObject({ title: "New", assigneeId: null });
  });

  it("a 404 (task gone) is thrown and triggers a re-sync", async () => {
    api.tasks.update.mockRejectedValueOnce(apiError(404, "TASK_NOT_FOUND", "Task not found"));
    api.boards.get.mockResolvedValueOnce({ board: makeBoard({ columns: [makeColumn("c1", "Todo", 0)], tasks: [makeTask("t2", "c1", "Ship it", 0)] }) });
    await expect(store().updateTaskDetails("t1", { title: "x" })).rejects.toMatchObject({ status: 404 });
    await flush();
    expect(store().tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("a 401 ends the session and still throws", async () => {
    api.tasks.update.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED"));
    await expect(store().updateTaskDetails("t1", { title: "x" })).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().status).toBe("anonymous");
  });
});
