/**
 * Opt-in end-to-end check of lib/api against a REAL running backend + PostgreSQL (not part of `npm test`).
 *
 *   1. start the backend:   cd backend && npm run dev          (needs a migrated database)
 *   2. run this file:       cd frontend && API_URL=http://localhost:4000 npm run test:integration
 *
 * It registers a throw-away user with a random email each run and leaves its data in the dev database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError, createApi, createApiClient } from "@/lib/api";
import type { BoardDetail, TaskDto } from "@/types/api";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Node has no browser cookie jar, so emulate one: store Set-Cookie values and replay them as Cookie. */
function cookieJarFetch(): typeof fetch {
  const jar = new Map<string, string>();
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await fetch(input, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attrs] = cookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      const expired = attrs.some((a) => /^\s*expires=/i.test(a) && new Date(a.split("=")[1]).getTime() < Date.now());
      if (expired || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
}

const newApi = () => createApi(createApiClient({ baseUrl: API_URL, fetchImpl: cookieJarFetch() }));
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error, `expected ApiError ${status} ${code}`).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status, code });
  return error as ApiError;
}

const titles = (board: BoardDetail, columnId: string) =>
  board.tasks
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.title);

describe("lib/api against the real backend", () => {
  const api = newApi();
  const alice = { name: "Alice Integration", email: `alice-${stamp}@example.com`, password: "password123" };
  let boardId: string;
  let todo: string;
  let doing: string;
  let done: string;
  let taskA: TaskDto;
  let taskB: TaskDto;
  let taskC: TaskDto;

  beforeAll(async () => {
    const res = await fetch(`${API_URL}/api/auth/me`).catch(() => undefined);
    if (!res) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && npm run dev).`);
  });

  it("registers (normalising the email, never returning a password) and keeps the session in the cookie", async () => {
    const { user } = await api.auth.register({ ...alice, email: alice.email.toUpperCase() });
    expect(user).toMatchObject({ name: alice.name, email: alice.email });
    expect(JSON.stringify(user)).not.toMatch(/password/i);

    expect((await api.auth.me()).user.id).toBe(user.id);
  });

  it("creates a board, three columns and tasks", async () => {
    const { board } = await api.boards.create({ name: "Integration board", description: "created by the client test" });
    boardId = board.id;
    expect(board).toMatchObject({ myRole: "OWNER", memberCount: 1, taskCount: 0 });

    todo = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    doing = (await api.columns.create(boardId, { title: "Doing" })).column.id;
    done = (await api.columns.create(boardId, { title: "Done" })).column.id;

    taskA = (await api.tasks.create(boardId, { title: "A", columnId: todo })).task;
    taskB = (await api.tasks.create(boardId, { title: "B", columnId: todo, priority: "HIGH", dueDate: "2026-10-15" })).task;
    taskC = (await api.tasks.create(boardId, { title: "C", columnId: todo })).task;
    expect([taskA.position, taskB.position, taskC.position]).toEqual([0, 1, 2]);
    expect(taskB).toMatchObject({ priority: "HIGH", dueDate: "2026-10-15" });
  });

  it("loads the whole board in one call, ordered", async () => {
    const { board } = await api.boards.get(boardId);
    expect(board.myRole).toBe("OWNER");
    expect(board.columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Done"]);
    expect(titles(board, todo)).toEqual(["A", "B", "C"]);
    expect(board.members).toHaveLength(1);
  });

  it("moves a task across columns and the response matches what a reload shows", async () => {
    const moved = await api.tasks.move(taskB.id, { columnId: doing, position: 0 });
    expect(moved.task).toMatchObject({ id: taskB.id, columnId: doing, position: 0 });
    const byColumn = Object.fromEntries(moved.columns.map((c) => [c.columnId, c.taskIds]));
    expect(byColumn[doing]).toEqual([taskB.id]);
    expect(byColumn[todo]).toEqual([taskA.id, taskC.id]);

    const { board } = await api.boards.get(boardId);
    expect(titles(board, todo)).toEqual(["A", "C"]);
    expect(titles(board, doing)).toEqual(["B"]);
  });

  it("reorders within a column", async () => {
    await api.tasks.move(taskC.id, { columnId: todo, position: 0 });
    expect(titles((await api.boards.get(boardId)).board, todo)).toEqual(["C", "A"]);
  });

  it("reorders columns, and a stale list is rejected with 409", async () => {
    const { columns } = await api.columns.reorder(boardId, [done, todo, doing]);
    expect(columns.map((c) => c.title)).toEqual(["Done", "Todo", "Doing"]);
    expect((await api.boards.get(boardId)).board.columns.map((c) => c.title)).toEqual(["Done", "Todo", "Doing"]);

    await expectApiError(api.columns.reorder(boardId, [done, todo]), 409, "COLUMN_LIST_OUT_OF_DATE");
  });

  it("edits, assigns and reads task detail", async () => {
    const { task } = await api.tasks.update(taskA.id, { title: "A (edited)", description: "details", dueDate: null });
    expect(task).toMatchObject({ title: "A (edited)", description: "details", dueDate: null });

    const { user } = await api.auth.me();
    expect((await api.tasks.assign(taskA.id, user.id)).task.assigneeId).toBe(user.id);
    const detail = (await api.tasks.get(taskA.id)).task;
    expect(detail.assignee).toMatchObject({ id: user.id, name: alice.name });
    expect(detail.createdBy.id).toBe(user.id);
    expect((await api.tasks.assign(taskA.id, null)).task.assigneeId).toBeNull();
  });

  it("surfaces validation and business-rule errors as ApiError with code and details", async () => {
    const validation = await expectApiError(api.boards.create({ name: "" }), 422, "VALIDATION_ERROR");
    expect(validation.details).toEqual([expect.objectContaining({ field: "name" })]);

    await expectApiError(api.tasks.assign(taskA.id, "no-such-user"), 422, "INVALID_ASSIGNEE");
    await expectApiError(api.tasks.move(taskA.id, { columnId: "no-such-column", position: 0 }), 404, "COLUMN_NOT_FOUND");
    await expectApiError(api.tasks.get("no-such-task"), 404, "TASK_NOT_FOUND");
  });

  it("renames and deletes a column (its tasks go with it)", async () => {
    expect((await api.columns.rename(doing, { title: "In Progress" })).column.title).toBe("In Progress");
    await api.columns.delete(doing);
    const { board } = await api.boards.get(boardId);
    expect(board.columns.map((c) => c.title)).toEqual(["Done", "Todo"]);
    expect(board.columns.map((c) => c.position)).toEqual([0, 1]);
    expect(board.tasks.map((t) => t.title).sort()).toEqual(["A (edited)", "C"]); // B lived in the deleted column
  });

  it("lists the board with counts, and deletes a task", async () => {
    expect((await api.boards.list()).boards.find((b) => b.id === boardId)).toMatchObject({ taskCount: 2, memberCount: 1 });
    await api.tasks.delete(taskC.id);
    expect((await api.tasks.list(boardId)).tasks.map((t) => t.title)).toEqual(["A (edited)"]);
  });

  it("keeps another user out of the board (404, not 403)", async () => {
    const bob = newApi();
    await bob.auth.register({ name: "Bob Integration", email: `bob-${stamp}@example.com`, password: "password123" });
    await expectApiError(bob.boards.get(boardId), 404, "BOARD_NOT_FOUND");
    await expectApiError(bob.tasks.get(taskA.id), 404, "TASK_NOT_FOUND");
    expect((await bob.boards.list()).boards).toEqual([]);
  });

  it("rejects bad credentials, then logs out and loses access", async () => {
    await expectApiError(newApi().auth.login({ email: alice.email, password: "wrong-password" }), 401, "INVALID_CREDENTIALS");

    await api.auth.logout();
    await expectApiError(api.auth.me(), 401, "UNAUTHORIZED");
    await expectApiError(api.boards.list(), 401, "UNAUTHORIZED");

    await api.auth.login({ email: alice.email, password: alice.password });
    await api.boards.delete(boardId);
    await expectApiError(api.boards.get(boardId), 404, "BOARD_NOT_FOUND");
  });

  it("reports an unreachable server as NETWORK_ERROR", async () => {
    const offline = createApi(createApiClient({ baseUrl: "http://127.0.0.1:9", fetchImpl: cookieJarFetch() }));
    await expectApiError(offline.boards.list(), 0, "NETWORK_ERROR");
  });
});
