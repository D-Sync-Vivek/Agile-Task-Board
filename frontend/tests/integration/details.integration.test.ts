/**
 * Opt-in: the task detail form's save action (updateTaskDetails) with the REAL store and a REAL backend + PostgreSQL.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { ApiError } = await import("@/lib/api/client");
const { getFieldErrors } = await import("@/lib/errors");
const { useBoardStore } = await import("@/store/useBoardStore");
const { useAuthStore } = await import("@/store/useAuthStore");

const store = () => useBoardStore.getState();
const local = (id: string) => store().tasks.find((t) => t.id === id)!;
const server = async (boardId: string, id: string) => (await api.boards.get(boardId)).board.tasks.find((t) => t.id === id);

describe("task detail saves against the real backend", () => {
  let boardId: string;
  let taskId: string;
  let myId: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && npm run dev).`);
    installCookieJar();
    await useAuthStore.getState().register({ name: "Details Tester", email: `details-${stamp}@example.com`, password: "password123" });
    myId = useAuthStore.getState().user!.id;

    boardId = (await api.boards.create({ name: "Details integration" })).board.id;
    const columnId = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    taskId = (await api.tasks.create(boardId, { title: "Original", columnId })).task.id;
    await store().loadBoard(boardId);
  });

  it("saves every field the form edits, and the store matches the database", async () => {
    const before = local(taskId).updatedAt;
    await store().updateTaskDetails(taskId, { title: "Implement authentication", description: "Add JWT authentication", priority: "HIGH", dueDate: "2026-10-15", assigneeId: myId });

    const saved = await server(boardId, taskId);
    expect(saved).toMatchObject({ title: "Implement authentication", description: "Add JWT authentication", priority: "HIGH", dueDate: "2026-10-15", assigneeId: myId });
    expect(local(taskId)).toMatchObject({ title: saved!.title, description: saved!.description, priority: saved!.priority, dueDate: saved!.dueDate, assigneeId: saved!.assigneeId, updatedAt: saved!.updatedAt });
    expect(new Date(saved!.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());

    const detail = (await api.tasks.get(taskId)).task; // what the panel's "created by" relies on
    expect(detail.createdBy).toMatchObject({ id: myId, name: "Details Tester" });
    expect(detail.assignee).toMatchObject({ id: myId });
  });

  it("clears description, due date and assignee with null", async () => {
    await store().updateTaskDetails(taskId, { description: null, dueDate: null, assigneeId: null });
    expect(await server(boardId, taskId)).toMatchObject({ description: null, dueDate: null, assigneeId: null });
    expect(local(taskId)).toMatchObject({ description: null, dueDate: null, assigneeId: null });
  });

  it("rejects bad input with field-level messages the form can display, and changes nothing", async () => {
    const cases: [object, string][] = [
      [{ title: "x".repeat(201) }, "title"],
      [{ description: "d".repeat(10001) }, "description"],
      [{ dueDate: "2026-02-30" }, "dueDate"],
    ];
    for (const [changes, field] of cases) {
      const error = await store().updateTaskDetails(taskId, changes).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
      expect(Object.keys(getFieldErrors(error))).toContain(field);
    }
    expect(await server(boardId, taskId)).toMatchObject({ title: "Implement authentication", dueDate: null });
    expect(local(taskId).title).toBe("Implement authentication");
  });

  it("an assignee who isn't on the board is refused (INVALID_ASSIGNEE); the content part of the same save still lands", async () => {
    const error = await store().updateTaskDetails(taskId, { title: "Saved despite assignee error", assigneeId: "not-a-member" }).then(() => undefined, (e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: "INVALID_ASSIGNEE" });
    expect((await server(boardId, taskId))?.title).toBe("Saved despite assignee error");
    expect(local(taskId)).toMatchObject({ title: "Saved despite assignee error", assigneeId: null });
  });

  it("a task deleted elsewhere: the save fails with 404 and the board re-syncs (so the panel can close)", async () => {
    await api.tasks.delete(taskId);
    await expect(store().updateTaskDetails(taskId, { title: "Ghost edit" })).rejects.toMatchObject({ status: 404, code: "TASK_NOT_FOUND" });
    await new Promise((r) => setTimeout(r, 400));
    expect(store().tasks.find((t) => t.id === taskId)).toBeUndefined();
  });
});
