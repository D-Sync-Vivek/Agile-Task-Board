/**
 * Opt-in: drag-and-drop persistence with the REAL store and a REAL backend + PostgreSQL.
 * Drags are emulated the way the hook does them (rearrange locally, then end the drag), then the database is read back
 * through a fresh API call to prove what is on screen equals what was saved.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { useBoardStore } = await import("@/store/useBoardStore");
const { useAuthStore } = await import("@/store/useAuthStore");
const { useToastStore } = await import("@/store/useToastStore");

const store = () => useBoardStore.getState();
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const localOrder = (columnId: string) => store().tasks.filter((t) => t.columnId === columnId).map((t) => t.title);

async function serverOrder(boardId: string, columnId: string) {
  const { board } = await api.boards.get(boardId);
  return board.tasks.filter((t) => t.columnId === columnId).sort((a, b) => a.position - b.position).map((t) => t.title);
}

function localMove(title: string, columnId: string, index: number) {
  const tasks = store().tasks;
  const moving = { ...tasks.find((t) => t.title === title)!, columnId };
  const rest = tasks.filter((t) => t.id !== moving.id);
  const anchor = rest.filter((t) => t.columnId === columnId)[index];
  rest.splice(anchor ? rest.indexOf(anchor) : rest.length, 0, moving);
  store().setTasks(rest);
}

async function drag(title: string, columnId: string, index: number) {
  const id = store().tasks.find((t) => t.title === title)!.id;
  store().beginDrag();
  localMove(title, columnId, index);
  await store().endDragTask(id);
}

describe("drag-and-drop persistence against the real backend", () => {
  let boardId: string;
  let todo: string;
  let doing: string;
  let done: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);
    installCookieJar();
    await useAuthStore.getState().register({ name: "Drag Tester", email: `drag-${stamp}@example.com`, password: "password123" });

    boardId = (await api.boards.create({ name: "Drag integration" })).board.id;
    todo = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    doing = (await api.columns.create(boardId, { title: "Doing" })).column.id;
    done = (await api.columns.create(boardId, { title: "Done" })).column.id;
    for (const title of ["A", "B", "C", "D"]) await api.tasks.create(boardId, { title, columnId: todo });
    await api.tasks.create(boardId, { title: "X", columnId: doing });
    await store().loadBoard(boardId);
  });

  it("persists a move within a column", async () => {
    await drag("D", todo, 0);
    expect(localOrder(todo)).toEqual(["D", "A", "B", "C"]);
    expect(await serverOrder(boardId, todo)).toEqual(["D", "A", "B", "C"]);
  });

  it("persists a move across columns (into the middle) and compacts the source", async () => {
    await drag("A", doing, 0);
    expect(await serverOrder(boardId, doing)).toEqual(["A", "X"]);
    expect(await serverOrder(boardId, todo)).toEqual(["D", "B", "C"]);
    expect(localOrder(doing)).toEqual(["A", "X"]);
  });

  it("persists a move into an empty column and to the end of another", async () => {
    await drag("X", done, 0);
    await drag("B", doing, 99);
    expect(await serverOrder(boardId, done)).toEqual(["X"]);
    expect(await serverOrder(boardId, doing)).toEqual(["A", "B"]);
    expect(await serverOrder(boardId, todo)).toEqual(["D", "C"]);
  });

  it("a full reload shows exactly the arrangement the user left (what you see is what is saved)", async () => {
    const before = { todo: localOrder(todo), doing: localOrder(doing), done: localOrder(done) };
    await store().loadBoard(boardId); // like pressing refresh
    expect({ todo: localOrder(todo), doing: localOrder(doing), done: localOrder(done) }).toEqual(before);
    expect(toasts()).toEqual([]);
  });

  it("several quick drags in a row all persist, in order", async () => {
    await Promise.all([drag("D", doing, 0), drag("C", done, 0), drag("A", todo, 0)]);
    const server = { todo: await serverOrder(boardId, todo), doing: await serverOrder(boardId, doing), done: await serverOrder(boardId, done) };
    expect({ todo: localOrder(todo), doing: localOrder(doing), done: localOrder(done) }).toEqual(server);
    expect(Object.values(server).flat().sort()).toEqual(["A", "B", "C", "D", "X"]); // nothing lost or duplicated
  });

  it("persists a column reorder", async () => {
    store().beginDrag();
    store().setColumns([store().columns[2], store().columns[0], store().columns[1]]);
    await store().endDragColumn();
    const server = (await api.boards.get(boardId)).board.columns.map((c) => c.title);
    expect(server).toEqual(["Done", "Todo", "Doing"]);
    expect(store().columns.map((c) => c.title)).toEqual(server);
  });

  it("Escape sends nothing: the server keeps its order", async () => {
    const before = await serverOrder(boardId, doing);
    store().beginDrag();
    localMove("B", todo, 0);
    store().cancelDrag();
    expect(await serverOrder(boardId, doing)).toEqual(before);
    expect(localOrder(doing)).toEqual(before);
  });

  it("a task deleted elsewhere: the move is rolled back, explained, and the board re-syncs", async () => {
    const ghost = store().tasks.find((t) => t.title === "B")!;
    await api.tasks.delete(ghost.id); // another browser deleted it; this one doesn't know
    useToastStore.setState({ toasts: [] });

    await drag("B", todo, 0);
    await new Promise((r) => setTimeout(r, 400)); // background re-sync
    expect(toasts()).toEqual(["Task not found"]);
    expect(store().tasks.find((t) => t.id === ghost.id)).toBeUndefined();
    const server = (await api.boards.get(boardId)).board.tasks.map((t) => t.id).sort();
    expect(store().tasks.map((t) => t.id).sort()).toEqual(server);
  });

  it("a stale column list (a column was added elsewhere): rolled back, explained, re-synced", async () => {
    await api.columns.create(boardId, { title: "Added elsewhere" });
    useToastStore.setState({ toasts: [] });
    const titlesBefore = store().columns.map((c) => c.title);

    store().beginDrag();
    store().setColumns([store().columns[1], store().columns[0], ...store().columns.slice(2)]);
    await store().endDragColumn();
    await new Promise((r) => setTimeout(r, 400));

    expect(toasts()).toEqual(["The column list is out of date. Reload the board and try again."]);
    expect(store().columns.map((c) => c.title)).toEqual([...titlesBefore, "Added elsewhere"]); // now includes the new column
    expect(store().columns.map((c) => c.title)).toEqual((await api.boards.get(boardId)).board.columns.map((c) => c.title));
  });
});
