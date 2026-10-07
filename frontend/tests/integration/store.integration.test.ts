/**
 * Opt-in: the REAL Zustand stores talking to a REAL backend + PostgreSQL (see api.integration.test.ts for how to run).
 * Node has no browser cookie jar, so global fetch is wrapped to keep the session cookie.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL; // must be set before @/lib/api is first imported

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { useBoardStore } = await import("@/store/useBoardStore");
const { useAuthStore } = await import("@/store/useAuthStore");
const { useToastStore } = await import("@/store/useToastStore");

const store = () => useBoardStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const titlesIn = (columnId: string) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.title);

describe("board store against the real backend", () => {
  let clearCookies: () => void;
  let boardId: string;
  let todo: string;
  let doing: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);
    clearCookies = installCookieJar();

    await useAuthStore.getState().register({ name: "Store Tester", email: `store-${stamp}@example.com`, password: "password123" });
    boardId = (await api.boards.create({ name: "Store integration" })).board.id;
    todo = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    doing = (await api.columns.create(boardId, { title: "Doing" })).column.id;
    await api.tasks.create(boardId, { title: "Seed A", columnId: todo });
    await api.tasks.create(boardId, { title: "Seed B", columnId: todo });
  });

  it("loads the board with the caller's permissions", async () => {
    await store().loadBoard(boardId);
    expect(store().status).toBe("ready");
    expect(store().columns.map((c) => c.title)).toEqual(["Todo", "Doing"]);
    expect(titlesIn(todo)).toEqual(["Seed A", "Seed B"]);
    expect(store().board?.myRole).toBe("OWNER");
    expect(store().board?.myPermissions).toHaveLength(13);
  });

  it("creates a column and a task, confirmed by the server", async () => {
    await store().addColumn();
    expect(store().columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Column 3"]);
    await store().addTask(doing);
    expect(titlesIn(doing)).toEqual(["Double Click to edit"]);

    const server = (await api.boards.get(boardId)).board;
    expect(server.columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Column 3"]);
    expect(server.tasks.filter((t) => t.columnId === doing).map((t) => t.title)).toEqual(["Double Click to edit"]);
  });

  it("persists a task edit (form save) and an optimistic column rename (trimmed)", async () => {
    const task = store().tasks.find((t) => t.title === "Seed A")!;
    await store().updateTaskDetails(task.id, { title: "Seed A (edited)" });
    await store().renameColumn(doing, " In Progress ");

    const server = (await api.boards.get(boardId)).board;
    expect(server.tasks.find((t) => t.id === task.id)?.title).toBe("Seed A (edited)");
    expect(server.columns.find((c) => c.id === doing)?.title).toBe("In Progress");
    expect(toasts()).toEqual([]);
  });

  it("rolls back a rejected rename and shows the server's validation message", async () => {
    await store().renameColumn(todo, "x".repeat(101));
    expect(store().columns.find((c) => c.id === todo)?.title).toBe("Todo"); // rolled back
    expect(toasts()).toEqual(["Column title must be at most 100 characters"]);
    expect((await api.boards.get(boardId)).board.columns.find((c) => c.id === todo)?.title).toBe("Todo");
    useToastStore.setState({ toasts: [] });
  });

  it("editing a task the server no longer has: the save fails with the API error and the board re-syncs", async () => {
    const task = store().tasks.find((t) => t.title === "Seed B")!;
    await api.tasks.delete(task.id); // someone else deleted it; our store doesn't know

    await expect(store().updateTaskDetails(task.id, { title: "Edit a ghost" })).rejects.toMatchObject({ status: 404, code: "TASK_NOT_FOUND" });
    await new Promise((r) => setTimeout(r, 300)); // let the background resync finish
    expect(store().tasks.find((t) => t.id === task.id)).toBeUndefined(); // converged with the server
  });

  it("deletes a task and a column (with its tasks), persisted", async () => {
    const task = store().tasks.find((t) => t.title === "Seed A (edited)")!;
    await store().deleteTask(task.id);
    await store().deleteColumn(doing);

    const server = (await api.boards.get(boardId)).board;
    expect(server.tasks.find((t) => t.id === task.id)).toBeUndefined();
    expect(server.columns.map((c) => c.id)).toEqual([todo, server.columns[1].id]);
    expect(server.tasks.every((t) => t.columnId !== doing)).toBe(true);
    expect(store().columns.map((c) => c.id)).toEqual(server.columns.map((c) => c.id));
    expect(toasts()).toEqual([]);
  });

  it("shows another user's request for this board as not found", async () => {
    store().reset();
    clearCookies();
    await useAuthStore.getState().register({ name: "Other User", email: `other-${stamp}@example.com`, password: "password123" });
    await store().loadBoard(boardId);
    expect(store().status).toBe("error");
    expect(store().error).toMatchObject({ status: 404, code: "BOARD_NOT_FOUND" });
    expect(store().board).toBeNull();
  });

  it("treats a lost session as logged out instead of toasting", async () => {
    await useAuthStore.getState().register({ name: "Third User", email: `third-${stamp}@example.com`, password: "password123" });
    const own = (await api.boards.create({ name: "Mine" })).board.id;
    await api.columns.create(own, { title: "Col" });
    await store().loadBoard(own);
    expect(store().status).toBe("ready");

    await api.auth.logout(); // cookie gone, but the UI doesn't know yet
    useToastStore.setState({ toasts: [] });
    await store().addColumn(); // -> 401
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(toasts()).toEqual([]);
  });
});
