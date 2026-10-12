/**
 * Opt-in: real-time with the REAL backend, REAL Socket.IO and PostgreSQL.
 * "Bea" is the browser under test (real socket client + real stores). "Al" acts through plain HTTP, like another
 * person in another browser. Everything Bea sees on screen must arrive without her doing anything.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const rawFetch = globalThis.fetch; // before the cookie jar wraps it: used to act as Al, with his own cookie
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const AL = { name: "Al Actor", email: `al-${stamp}@example.com`, password: "password123" };
const BEA = { name: "Bea Browser", email: `bea-${stamp}@example.com`, password: "password123" };

const { openSocket, closeSocket, getSocketId } = await import("@/lib/realtime/socket");
const { registerBoardHandlers } = await import("@/lib/realtime/handlers");
const { describeActivity } = await import("@/lib/activity");
const { useBoardStore } = await import("@/store/useBoardStore");
const { useCommentStore } = await import("@/store/useCommentStore");
const { useBoardActivityStore } = await import("@/store/useActivityStores");
const { useAuthStore } = await import("@/store/useAuthStore");

let cookieAl = "";
let cookieBea = "";
let boardId = "";
let columnTodo = "";
let columnDoing = "";
let taskId = "";

async function register(person: typeof AL): Promise<string> {
  const response = await rawFetch(`${API_URL}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(person) });
  if (!response.ok) throw new Error(`register failed: ${response.status}`);
  return response.headers.getSetCookie()[0].split(";")[0];
}

/** An HTTP call as Al (no X-Socket-Id: from Bea's point of view it is somebody else's change). */
async function asAl<T = any>(method: string, path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await rawFetch(`${API_URL}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookieAl }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!json.success) throw new Error(`${method} ${path} -> ${response.status} ${json.error?.code}`);
  return json.data;
}

async function until(condition: () => boolean, what: string, ms = 4000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const tasks = () => useBoardStore.getState().tasks;
const callbacks = { removed: vi.fn(), deleted: vi.fn() };
let socket: ReturnType<typeof openSocket>;
const counted: Record<string, number> = {};

beforeAll(async () => {
  const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
  if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);

  cookieAl = await register(AL);
  cookieBea = await register(BEA);
  installCookieJar();
  await useAuthStore.getState().login?.({ email: BEA.email, password: BEA.password }); // Bea's REST calls use the jar

  boardId = (await asAl("POST", "/api/boards", { name: "Realtime integration" })).board.id;
  await asAl("POST", `/api/boards/${boardId}/members`, { email: BEA.email, role: "MEMBER" });
  columnTodo = (await asAl("POST", `/api/boards/${boardId}/columns`, { title: "Todo" })).column.id;
  columnDoing = (await asAl("POST", `/api/boards/${boardId}/columns`, { title: "Doing" })).column.id;
  taskId = (await asAl("POST", `/api/boards/${boardId}/tasks`, { title: "Existing", columnId: columnTodo })).task.id;

  // Bea opens the board: load it, connect with HER cookie, join the room, listen.
  await useBoardStore.getState().loadBoard(boardId);
  socket = openSocket(API_URL, { extraHeaders: { cookie: cookieBea } });
  socket.onAny((event: string) => {
    counted[event] = (counted[event] ?? 0) + 1;
  });
  registerBoardHandlers(socket, { onRemovedFromBoard: callbacks.removed, onBoardDeleted: callbacks.deleted });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const ack = await socket.emitWithAck("board:join", { boardId });
  expect(ack).toEqual({ ok: true });
});

afterAll(() => closeSocket());

describe("real-time against the real backend", () => {
  it("a task Al creates appears on Bea's board by itself", async () => {
    const { task } = await asAl("POST", `/api/boards/${boardId}/tasks`, { title: "Created by Al", columnId: columnTodo });
    await until(() => tasks().some((t) => t.id === task.id), "task to appear");
    expect(tasks().find((t) => t.id === task.id)?.title).toBe("Created by Al");
  });

  it("edits, assignment, moves and deletes by Al show up", async () => {
    const beaId = useAuthStore.getState().user!.id;
    await asAl("PATCH", `/api/tasks/${taskId}`, { title: "Renamed by Al", priority: "URGENT" });
    await until(() => tasks().find((t) => t.id === taskId)?.title === "Renamed by Al", "title");
    expect(tasks().find((t) => t.id === taskId)?.priority).toBe("URGENT");

    await asAl("PATCH", `/api/tasks/${taskId}/assign`, { assigneeId: beaId });
    await until(() => tasks().find((t) => t.id === taskId)?.assigneeId === beaId, "assignee");

    await asAl("PATCH", `/api/tasks/${taskId}/move`, { columnId: columnDoing, position: 0 });
    await until(() => tasks().find((t) => t.id === taskId)?.columnId === columnDoing, "move");

    await asAl("DELETE", `/api/tasks/${taskId}`);
    await until(() => !tasks().some((t) => t.id === taskId), "delete");
  });

  it("columns: rename, reorder, create, delete", async () => {
    await asAl("PATCH", `/api/columns/${columnDoing}`, { title: "In Progress" });
    await until(() => useBoardStore.getState().columns.find((c) => c.id === columnDoing)?.title === "In Progress", "rename");

    await asAl("PATCH", `/api/boards/${boardId}/columns/reorder`, { columnIds: [columnDoing, columnTodo] });
    await until(() => useBoardStore.getState().columns[0].id === columnDoing, "reorder");

    const { column } = await asAl("POST", `/api/boards/${boardId}/columns`, { title: "Review" });
    await until(() => useBoardStore.getState().columns.some((c) => c.id === column.id), "create");
    await asAl("DELETE", `/api/columns/${column.id}`);
    await until(() => !useBoardStore.getState().columns.some((c) => c.id === column.id), "delete");
  });

  it("the open activity feed and the open task's comments update live", async () => {
    await useBoardActivityStore.getState().load(boardId);
    const { task } = await asAl("POST", `/api/boards/${boardId}/tasks`, { title: "Discuss me", columnId: columnTodo });
    await until(() => tasks().some((t) => t.id === task.id), "task");
    await useCommentStore.getState().load(task.id);

    await asAl("POST", `/api/tasks/${task.id}/comments`, { content: "Hello from Al" });
    await until(() => useCommentStore.getState().comments.some((c) => c.content === "Hello from Al"), "comment");
    await until(() => useBoardActivityStore.getState().entries.some((e) => e.action === "COMMENT_ADDED"), "activity entry");

    const sentences = useBoardActivityStore.getState().entries.map(describeActivity);
    expect(sentences[0]).toBe("commented on “Discuss me”");
    expect(sentences).toContain("created task “Discuss me” in Todo");
  });

  it("Bea's own change is not echoed back to her tab (X-Socket-Id), but its activity entry still arrives", async () => {
    expect(getSocketId()).toBe(socket.id); // the REST client sends this tab's socket id
    const createdBefore = counted["task:created"] ?? 0;
    const activityBefore = counted["activity:created"] ?? 0;

    await useBoardStore.getState().addTask(columnTodo, "Created by Bea");
    await until(() => (counted["activity:created"] ?? 0) > activityBefore, "activity for her own change");
    await new Promise((r) => setTimeout(r, 300));

    expect(counted["task:created"] ?? 0).toBe(createdBefore); // no echo of her own task:created
    expect(tasks().filter((t) => t.title === "Created by Bea")).toHaveLength(1); // and certainly not twice
  });

  it("when Al removes Bea she is told, and she can no longer rejoin", async () => {
    const members = (await asAl("GET", `/api/boards/${boardId}/members`)).members as { id: string; user: { email: string } }[];
    const bea = members.find((m) => m.user.email === BEA.email)!;
    await asAl("DELETE", `/api/boards/${boardId}/members/${bea.id}`);
    await until(() => callbacks.removed.mock.calls.length === 1, "removal notice");

    expect(await socket.emitWithAck("board:join", { boardId })).toMatchObject({ ok: false, error: { code: "BOARD_NOT_FOUND" } });
  });

  it("when a board is deleted, a watching member is told", async () => {
    // Bea's first board is gone for her; use a fresh one where she is a member.
    const second = (await asAl("POST", "/api/boards", { name: "Doomed" })).board.id;
    await asAl("POST", `/api/boards/${second}/members`, { email: BEA.email, role: "VIEWER" });
    expect(await socket.emitWithAck("board:join", { boardId: second })).toEqual({ ok: true });

    await asAl("DELETE", `/api/boards/${second}`);
    await until(() => callbacks.deleted.mock.calls.length === 1, "deletion notice");
  });
});
