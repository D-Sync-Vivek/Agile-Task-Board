/**
 * Opt-in: the comment store with the REAL backend + PostgreSQL. (Cross-user rules such as "members can't edit each
 * other's comments" need a second member on the board, which is covered by the backend test suite.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { useAuthStore } = await import("@/store/useAuthStore");
const { useBoardStore } = await import("@/store/useBoardStore");
const { useCommentStore } = await import("@/store/useCommentStore");
const { useToastStore } = await import("@/store/useToastStore");

const store = () => useCommentStore.getState();
const texts = () => store().comments.map((c) => c.content);
const serverTexts = async (taskId: string) => (await api.comments.list(taskId)).comments.map((c) => c.content);

describe("comments against the real backend", () => {
  let clearCookies: () => void;
  let boardId: string;
  let taskId: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);
    clearCookies = installCookieJar();
    await useAuthStore.getState().register({ name: "Comment Tester", email: `comments-${stamp}@example.com`, password: "password123" });

    boardId = (await api.boards.create({ name: "Comments integration" })).board.id;
    const columnId = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    taskId = (await api.tasks.create(boardId, { title: "Discuss me", columnId })).task.id;
    await useBoardStore.getState().loadBoard(boardId);
  });

  it("starts empty, then posts: the optimistic comment is replaced by the saved one", async () => {
    await store().load(taskId);
    expect(store().status).toBe("ready");
    expect(store().comments).toEqual([]);

    const posting = store().add(taskId, "  Can we move this to the next sprint?  ");
    expect(store().comments[0]).toMatchObject({ pending: true, content: "Can we move this to the next sprint?" });
    await posting;

    expect(store().comments).toHaveLength(1);
    const saved = store().comments[0];
    expect(saved.pending).toBeUndefined();
    expect(saved.id).not.toMatch(/^pending-/);
    expect(saved).toMatchObject({ edited: false, author: { name: "Comment Tester" } });
    expect(await serverTexts(taskId)).toEqual(["Can we move this to the next sprint?"]);
  });

  it("keeps comments in posting order", async () => {
    await store().add(taskId, "Yes, I'll handle it.");
    await store().add(taskId, "Thanks!");
    expect(texts()).toEqual(["Can we move this to the next sprint?", "Yes, I'll handle it.", "Thanks!"]);
    await store().load(taskId); // reload, like reopening the panel
    expect(texts()).toEqual(["Can we move this to the next sprint?", "Yes, I'll handle it.", "Thanks!"]);
  });

  it("edits my own comment: it persists and reads as edited", async () => {
    const target = store().comments[1];
    await store().edit(target.id, "  Yes, I will handle it.  ");
    expect(store().comments[1]).toMatchObject({ content: "Yes, I will handle it.", edited: true });
    const onServer = (await api.comments.list(taskId)).comments[1];
    expect(onServer).toMatchObject({ content: "Yes, I will handle it.", edited: true });
    expect(new Date(onServer.updatedAt).getTime()).toBeGreaterThan(new Date(onServer.createdAt).getTime());
  });

  it("deletes my own comment", async () => {
    await store().remove(store().comments[2].id);
    expect(texts()).toEqual(["Can we move this to the next sprint?", "Yes, I will handle it."]);
    expect(await serverTexts(taskId)).toEqual(texts());
  });

  it("rejects an over-long comment with a field message, and leaves nothing behind", async () => {
    const error = await store().add(taskId, "x".repeat(5001)).then(() => undefined, (e: unknown) => e);
    expect(error).toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(texts()).toHaveLength(2); // the pending copy was removed
    expect(await serverTexts(taskId)).toHaveLength(2);
  });

  it("a rejected edit rolls back and toasts the server's reason", async () => {
    useToastStore.setState({ toasts: [] });
    const target = store().comments[0];
    await store().edit(target.id, "y".repeat(5001));
    expect(store().comments[0].content).toBe(target.content);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["Comment must be at most 5000 characters"]);
  });

  it("commenting on a task deleted elsewhere fails with 404, and the board re-syncs", async () => {
    await api.tasks.delete(taskId);
    const error = await store().add(taskId, "anyone there?").then(() => undefined, (e: unknown) => e);
    expect(error).toMatchObject({ status: 404, code: "TASK_NOT_FOUND" });
    await new Promise((r) => setTimeout(r, 400));
    expect(useBoardStore.getState().tasks.find((t) => t.id === taskId)).toBeUndefined();
  });

  it("another user can't read a board's comments (404)", async () => {
    const columnId = (await api.columns.create(boardId, { title: "Again" })).column.id;
    const secret = (await api.tasks.create(boardId, { title: "Private", columnId })).task.id;
    await api.comments.create(secret, { content: "private note" });

    store().reset();
    clearCookies();
    await useAuthStore.getState().register({ name: "Intruder", email: `intruder-${stamp}@example.com`, password: "password123" });
    await store().load(secret);
    expect(store().status).toBe("error");
    expect(store().comments).toEqual([]);
  });
});
