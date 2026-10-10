/**
 * Opt-in: the activity feed with the REAL backend + PostgreSQL. Proves that what the services write is what the
 * frontend types, formatter and stores expect (the shapes can't drift apart unnoticed), and that paging works end to end.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { describeActivity, actorName } = await import("@/lib/activity");
const { useAuthStore } = await import("@/store/useAuthStore");
const { useBoardActivityStore, useTaskActivityStore } = await import("@/store/useActivityStores");

const board = () => useBoardActivityStore.getState();
const sentences = () => board().entries.map((e) => `${actorName(e, useAuthStore.getState().user?.id)} ${describeActivity(e)}`);

describe("activity against the real backend", () => {
  let boardId: string;
  let todo: string;
  let doing: string;
  let taskId: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);
    installCookieJar();
    await useAuthStore.getState().register({ name: "Activity Tester", email: `activity-${stamp}@example.com`, password: "password123" });

    boardId = (await api.boards.create({ name: "Activity integration" })).board.id;
    todo = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    doing = (await api.columns.create(boardId, { title: "Doing" })).column.id;
    taskId = (await api.tasks.create(boardId, { title: "Authentication", columnId: todo })).task.id;
    await api.tasks.update(taskId, { title: "Auth", priority: "HIGH", description: "JWT" });
    await api.tasks.move(taskId, { columnId: doing, position: 0 });
    await api.comments.create(taskId, { content: "On it" });
    await api.columns.rename(doing, { title: "In Progress" });
  });

  it("the board feed reads like the example in the spec, newest first", async () => {
    await board().load(boardId);
    expect(board().status).toBe("ready");
    expect(sentences()).toEqual([
      "You renamed column “Doing” to “In Progress”",
      "You commented on “Auth”",
      "You moved “Auth” from Todo to Doing",
      "You updated “Auth” (renamed from “Authentication”, priority Medium → High, description)",
      "You created task “Authentication” in Todo",
      "You added column “Doing”",
      "You added column “Todo”",
    ]);
    expect(board().nextCursor).toBeNull();
  });

  it("the task feed contains only that task's history (including its comment)", async () => {
    const other = (await api.tasks.create(boardId, { title: "Unrelated", columnId: todo })).task.id;
    await api.tasks.delete(other);

    await useTaskActivityStore.getState().load(taskId);
    const actions = useTaskActivityStore.getState().entries.map((e) => e.action);
    expect(actions).toEqual(["COMMENT_ADDED", "TASK_MOVED", "TASK_UPDATED", "TASK_CREATED"]);
  });

  it("deleting a task keeps its history readable (snapshots, no dangling references)", async () => {
    await board().load(boardId);
    expect(sentences()[0]).toBe("You deleted task “Unrelated” from Todo");
    expect(sentences()[1]).toBe("You created task “Unrelated” in Todo");
  });

  it("assigning is logged with names, and refresh() picks up new entries without reloading", async () => {
    await board().load(boardId);
    const before = board().entries.length;
    const me = useAuthStore.getState().user!;
    await api.tasks.assign(taskId, me.id);

    await board().refresh();
    expect(board().entries).toHaveLength(before + 1);
    expect(sentences()[0]).toBe("You assigned “Auth” to Activity Tester");
  });

  it("pages through a long history with Load more: no gaps, no duplicates", async () => {
    const paged = (await api.boards.create({ name: "Long history" })).board.id;
    const column = (await api.columns.create(paged, { title: "Todo" })).column.id;
    for (let i = 0; i < 24; i++) await api.tasks.create(paged, { title: `T${i}`, columnId: column });

    await board().load(paged); // 25 entries in total: 1 column + 24 tasks
    expect(board().entries).toHaveLength(20);
    expect(board().nextCursor).not.toBeNull();

    await board().loadMore();
    const ids = board().entries.map((e) => e.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(board().nextCursor).toBeNull();
    expect(sentences()[24]).toBe("You added column “Todo”"); // the oldest event is last
  });

  it("a feed for a board that isn't yours is refused", async () => {
    await expect(api.activity.forBoard("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
