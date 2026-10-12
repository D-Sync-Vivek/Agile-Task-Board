/* eslint-disable @typescript-eslint/no-explicit-any -- event payloads are dynamic JSON; asserting on them with full types would just restate the DTOs */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import request from "supertest";
import { io as connectClient } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { attachSocketServer } from "../src/sockets/socketServer";
import { createBoardWithMembers, createColumn, createTask, createUser, resetDatabase } from "./helpers";

const app = createApp();
const httpServer = createServer(app);
let url: string;
let io: ReturnType<typeof attachSocketServer>;

type Person = { id: string; cookie: string };
const people = {} as Record<"owner" | "admin" | "member" | "viewer" | "outsider", Person>;
let boardId: string;
let todo: string;
let doing: string;
const clients: Socket[] = [];

beforeAll(async () => {
  io = attachSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await io.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  people.owner = await createUser("Olivia Owner");
  people.admin = await createUser("Adam Admin");
  people.member = await createUser("Mia Member");
  people.viewer = await createUser("Victor Viewer");
  people.outsider = await createUser("Otto Outsider");
  boardId = await createBoardWithMembers(people.owner.id, [
    { userId: people.admin.id, role: "ADMIN" as BoardRole },
    { userId: people.member.id, role: "MEMBER" as BoardRole },
    { userId: people.viewer.id, role: "VIEWER" as BoardRole },
  ]);
  todo = (await createColumn(boardId, "Todo", 0)).id;
  doing = (await createColumn(boardId, "Doing", 1)).id;
});

afterEach(() => {
  while (clients.length) clients.pop()?.disconnect();
});

// ───────────── helpers ─────────────
function connect(cookie?: string, headers: Record<string, string> = {}): Promise<Socket> {
  const socket = connectClient(url, { transports: ["websocket"], forceNew: true, reconnection: false, extraHeaders: { ...(cookie && { cookie }), ...headers } });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

const join = (socket: Socket, id: unknown = boardId) => socket.emitWithAck("board:join", { boardId: id }) as Promise<{ ok: boolean; error?: { code: string } }>;

async function watcher(who: Person, board = boardId) {
  const socket = await connect(who.cookie);
  expect((await join(socket, board)).ok).toBe(true);
  return socket;
}

/** Resolves with the next payload of `event`, or rejects after a timeout. Call BEFORE triggering the change. */
function next<T = Record<string, any>>(socket: Socket, event: string, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Records every event a socket receives from now on. */
function record(socket: Socket) {
  const events: { event: string; payload: any }[] = [];
  socket.onAny((event, payload) => events.push({ event, payload }));
  return events;
}
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const names = (events: { event: string }[]) => events.map((e) => e.event);

const as = (who: Person) => ({
  post: (u: string, body: unknown, h: Record<string, string> = {}) => request(app).post(u).set("Cookie", who.cookie).set(h).send(body as object),
  patch: (u: string, body: unknown, h: Record<string, string> = {}) => request(app).patch(u).set("Cookie", who.cookie).set(h).send(body as object),
  del: (u: string, h: Record<string, string> = {}) => request(app).delete(u).set("Cookie", who.cookie).set(h),
});

const memberRowId = async (who: Person) => (await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId, userId: who.id } } })).id;

// ───────────── connection ─────────────
describe("connecting (authentication)", () => {
  it("accepts a valid session cookie", async () => {
    const socket = await connect(people.member.cookie);
    expect(socket.connected).toBe(true);
  });

  it("refuses a connection without a cookie, with a garbage token, and with a token signed by someone else", async () => {
    await expect(connect()).rejects.toThrow("UNAUTHORIZED");
    await expect(connect("taskboard_token=garbage")).rejects.toThrow("UNAUTHORIZED");
    const forged = jwt.sign({}, "some-other-secret-some-other-secret-1234", { subject: people.owner.id, expiresIn: 60 });
    await expect(connect(`taskboard_token=${forged}`)).rejects.toThrow("UNAUTHORIZED");
  });

  it("refuses an expired token and a token for a user that no longer exists", async () => {
    const secret = process.env.JWT_SECRET as string;
    const expired = jwt.sign({}, secret, { subject: people.owner.id, expiresIn: -10 });
    await expect(connect(`taskboard_token=${expired}`)).rejects.toThrow("UNAUTHORIZED");
    const ghost = jwt.sign({}, secret, { subject: "00000000-0000-4000-8000-000000000000", expiresIn: 60 });
    await expect(connect(`taskboard_token=${ghost}`)).rejects.toThrow("UNAUTHORIZED");
  });

  it("refuses a browser handshake from another site (cross-site WebSocket hijacking), allows ours and non-browser clients", async () => {
    await expect(connect(people.owner.cookie, { origin: "http://evil.example" })).rejects.toThrow("FORBIDDEN_ORIGIN");
    expect((await connect(people.owner.cookie, { origin: "http://localhost:3000" })).connected).toBe(true);
    expect((await connect(people.owner.cookie)).connected).toBe(true);
  });

  it("disconnects the socket when the cookie's token expires", async () => {
    const secret = process.env.JWT_SECRET as string;
    const shortLived = jwt.sign({}, secret, { subject: people.owner.id, expiresIn: 1 });
    const socket = await connect(`taskboard_token=${shortLived}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("still connected")), 3500);
      socket.once("disconnect", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
});

// ───────────── rooms ─────────────
describe("joining a board room (authorization)", () => {
  it("every member role may join", async () => {
    for (const who of [people.owner, people.admin, people.member, people.viewer]) {
      const socket = await connect(who.cookie);
      expect(await join(socket)).toEqual({ ok: true });
    }
  });

  it("an outsider is refused, with the same answer as for a board that doesn't exist", async () => {
    const socket = await connect(people.outsider.cookie);
    const refused = await join(socket);
    const missing = await join(socket, "00000000-0000-4000-8000-000000000000");
    expect(refused).toEqual({ ok: false, error: { code: "BOARD_NOT_FOUND", message: "Board not found" } });
    expect(missing).toEqual(refused);
  });

  it("rejects malformed payloads and survives a missing ack callback", async () => {
    const socket = await connect(people.member.cookie);
    expect((await join(socket, "not-a-uuid")).error?.code).toBe("VALIDATION_ERROR");
    expect(((await socket.emitWithAck("board:join", null)) as { ok: boolean }).ok).toBe(false);
    socket.emit("board:join", { boardId }); // no ack callback
    await settle(100);
    expect(socket.connected).toBe(true);
  });

  it("an outsider never receives anything from the board, even while connected", async () => {
    const outsider = await connect(people.outsider.cookie);
    await join(outsider);
    const events = record(outsider);
    await as(people.member).post(`/api/boards/${boardId}/tasks`, { title: "Secret", columnId: todo });
    await settle();
    expect(events).toEqual([]);
  });

  it("leaving stops the events", async () => {
    const socket = await watcher(people.member);
    const events = record(socket);
    expect(await socket.emitWithAck("board:leave", { boardId })).toEqual({ ok: true });
    await as(people.owner).post(`/api/boards/${boardId}/tasks`, { title: "After leaving", columnId: todo });
    await settle();
    expect(events).toEqual([]);
  });

  it("rooms are per board: watching one board never delivers another board's events", async () => {
    const otherBoard = await createBoardWithMembers(people.owner.id, [{ userId: people.member.id, role: "MEMBER" as BoardRole }]);
    const otherColumn = await createColumn(otherBoard, "Todo", 0);
    const socket = await watcher(people.member, boardId);
    const events = record(socket);
    await as(people.owner).post(`/api/boards/${otherBoard}/tasks`, { title: "Elsewhere", columnId: otherColumn.id });
    await settle();
    expect(events).toEqual([]);
  });
});

// ───────────── broadcasts ─────────────
describe("what is broadcast after a successful change", () => {
  it("tasks: created, updated, assigned, moved, deleted — to every role, with the REST payloads", async () => {
    const viewer = await watcher(people.viewer);
    const events = record(viewer);

    const created = await as(people.member).post(`/api/boards/${boardId}/tasks`, { title: "Ship it", columnId: todo });
    const taskId = created.body.data.task.id as string;
    await as(people.member).patch(`/api/tasks/${taskId}`, { title: "Ship it now", priority: "HIGH" });
    await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: people.admin.id });
    const moved = await as(people.member).patch(`/api/tasks/${taskId}/move`, { columnId: doing, position: 0 });
    await as(people.admin).del(`/api/tasks/${taskId}`);
    await settle();

    const byName = (n: string) => events.filter((e) => e.event === n).map((e) => e.payload);
    expect(byName("task:created")).toEqual([{ task: created.body.data.task, actorId: people.member.id }]);
    const updated = byName("task:updated");
    expect(updated).toHaveLength(2);
    expect(updated[0]).toMatchObject({ task: { id: taskId, title: "Ship it now", priority: "HIGH" }, actorId: people.member.id });
    expect(updated[1].task.assigneeId).toBe(people.admin.id);
    expect(byName("task:moved")).toEqual([{ task: moved.body.data.task, columns: moved.body.data.columns, actorId: people.member.id }]);
    expect(byName("task:deleted")).toEqual([{ taskId, actorId: people.admin.id }]);
  });

  it("columns: created, renamed, reordered, deleted", async () => {
    const socket = await watcher(people.member);
    const events = record(socket);

    const created = await as(people.admin).post(`/api/boards/${boardId}/columns`, { title: "Review" });
    const columnId = created.body.data.column.id as string;
    await as(people.admin).patch(`/api/columns/${columnId}`, { title: "In Review" });
    const reordered = await as(people.admin).patch(`/api/boards/${boardId}/columns/reorder`, { columnIds: [columnId, todo, doing] });
    await as(people.admin).del(`/api/columns/${columnId}`);
    await settle();

    expect(names(events).filter((n) => n.startsWith("column:"))).toEqual(["column:created", "column:updated", "column:reordered", "column:deleted"]);
    expect(events.find((e) => e.event === "column:updated")?.payload.column.title).toBe("In Review");
    expect(events.find((e) => e.event === "column:reordered")?.payload.columns).toEqual(reordered.body.data.columns);
    expect(events.find((e) => e.event === "column:deleted")?.payload).toEqual({ columnId, actorId: people.admin.id });
  });

  it("comments: created, edited, deleted (with the task they belong to)", async () => {
    const task = await createTask({ boardId, columnId: todo, createdById: people.owner.id, title: "Discuss", position: 0 });
    const socket = await watcher(people.viewer);
    const events = record(socket);

    const created = await as(people.member).post(`/api/tasks/${task.id}/comments`, { content: "first" });
    const commentId = created.body.data.comment.id as string;
    await as(people.member).patch(`/api/comments/${commentId}`, { content: "edited" });
    await as(people.owner).del(`/api/comments/${commentId}`); // moderator deletes
    await settle();

    const comments = events.filter((e) => e.event.startsWith("comment:"));
    expect(names(comments)).toEqual(["comment:created", "comment:updated", "comment:deleted"]);
    expect(comments[0].payload).toMatchObject({ taskId: task.id, actorId: people.member.id, comment: { id: commentId, content: "first", author: { name: "Mia Member" } } });
    expect(comments[1].payload.comment).toMatchObject({ content: "edited", edited: true });
    expect(comments[2].payload).toEqual({ commentId, taskId: task.id, actorId: people.owner.id });
  });

  it("members: added, role changed, removed", async () => {
    const newcomer = await createUser("Nina Newcomer");
    const socket = await watcher(people.viewer);
    const events = record(socket);

    const added = await as(people.owner).post(`/api/boards/${boardId}/members`, { email: "nina.newcomer@example.com", role: "VIEWER" });
    const memberId = added.body.data.member.id as string;
    await as(people.owner).patch(`/api/boards/${boardId}/members/${memberId}`, { role: "MEMBER" });
    await as(people.owner).del(`/api/boards/${boardId}/members/${memberId}`);
    await settle();

    const memberEvents = events.filter((e) => e.event.startsWith("member:"));
    expect(names(memberEvents)).toEqual(["member:added", "member:updated", "member:removed"]);
    expect(memberEvents[0].payload.member).toMatchObject({ id: memberId, role: "VIEWER", user: { name: "Nina Newcomer" } });
    expect(memberEvents[1].payload.member.role).toBe("MEMBER");
    expect(memberEvents[2].payload).toEqual({ memberId, userId: newcomer.id, actorId: people.owner.id });
  });

  it("board: renamed and deleted — and after deletion the room is empty", async () => {
    const socket = await watcher(people.member);
    const events = record(socket);
    await as(people.owner).patch(`/api/boards/${boardId}`, { name: "Renamed" });
    const deleted = next(socket, "board:deleted");
    await as(people.owner).del(`/api/boards/${boardId}`);
    expect(await deleted).toEqual({ boardId, actorId: people.owner.id });
    expect(events.find((e) => e.event === "board:updated")?.payload.board.name).toBe("Renamed");
    expect([...io.sockets.adapter.rooms.keys()]).not.toContain(`board:${boardId}`);
  });
});

describe("activity:created", () => {
  it("is pushed for each entry the change created — to everyone, including the sender", async () => {
    const watching = await watcher(people.viewer);
    const sender = await watcher(people.member);
    const toViewer = next<any>(watching, "activity:created");
    const toSender = next<any>(sender, "activity:created");

    await as(people.member).post(`/api/boards/${boardId}/tasks`, { title: "Logged", columnId: todo }, { "X-Socket-Id": sender.id as string });

    for (const { activity } of [await toViewer, await toSender]) {
      expect(activity).toMatchObject({ action: "TASK_CREATED", entityType: "TASK", actor: { id: people.member.id, name: "Mia Member" }, metadata: { taskTitle: "Logged", columnTitle: "Todo" } });
      expect(activity.id).toEqual(expect.any(String));
    }
  });

  it("matches what GET /activity returns", async () => {
    const socket = await watcher(people.owner);
    const pushed = next<any>(socket, "activity:created");
    await as(people.owner).post(`/api/boards/${boardId}/columns`, { title: "Review" });
    const { activity } = await pushed;
    const listed = await request(app).get(`/api/boards/${boardId}/activity`).set("Cookie", people.owner.cookie);
    expect(listed.body.data.activities[0]).toEqual(activity);
  });

  it("a request that creates no history (no-op rename) pushes none; a request with two entries (none exist today) would push in order", async () => {
    const socket = await watcher(people.owner);
    const events = record(socket);
    await as(people.owner).patch(`/api/columns/${todo}`, { title: "Todo" }); // same title
    await settle();
    expect(names(events)).toEqual(["column:updated"]);
  });
});

describe("the sender's own tab", () => {
  it("is skipped for the change event (X-Socket-Id) but other tabs of the same user receive it", async () => {
    const sendingTab = await watcher(people.member);
    const otherTab = await watcher(people.member);
    const own = record(sendingTab);
    const other = next(otherTab, "task:created");

    await as(people.member).post(`/api/boards/${boardId}/tasks`, { title: "Mine", columnId: todo }, { "X-Socket-Id": sendingTab.id as string });
    expect((await other).task.title).toBe("Mine");
    await settle();
    expect(names(own)).toEqual(["activity:created"]); // no task:created echo
  });
});

describe("nothing is broadcast for requests that failed", () => {
  it("forbidden, invalid and not-found requests emit no events and no activity", async () => {
    const socket = await watcher(people.owner);
    const events = record(socket);
    const task = await createTask({ boardId, columnId: todo, createdById: people.owner.id, title: "Guarded", position: 0 });

    expect((await as(people.viewer).patch(`/api/tasks/${task.id}`, { title: "hax" })).status).toBe(403);
    expect((await as(people.member).post(`/api/boards/${boardId}/columns`, { title: "nope" })).status).toBe(403);
    expect((await as(people.member).patch(`/api/tasks/${task.id}`, { title: "" })).status).toBe(422);
    expect((await as(people.member).patch(`/api/tasks/${task.id}/assign`, { assigneeId: people.outsider.id })).status).toBe(422);
    expect((await as(people.outsider).del(`/api/tasks/${task.id}`)).status).toBe(404);
    expect((await as(people.admin).post(`/api/boards/${boardId}/members`, { email: "nobody@example.com" })).status).toBe(404);
    await settle();
    expect(events).toEqual([]);
  });
});

describe("removing a member", () => {
  it("tells them, then cuts them off: no further events, and they cannot rejoin", async () => {
    const removed = await watcher(people.member);
    const staying = await watcher(people.viewer);
    const removedEvents = record(removed);
    const told = next(removed, "member:removed");

    expect((await as(people.owner).del(`/api/boards/${boardId}/members/${await memberRowId(people.member)}`)).status).toBe(200);
    expect(await told).toMatchObject({ userId: people.member.id });
    await settle();
    removedEvents.length = 0;

    const stillGetting = next(staying, "task:created");
    await as(people.owner).post(`/api/boards/${boardId}/tasks`, { title: "After removal", columnId: todo });
    await stillGetting;
    await settle();
    expect(removedEvents).toEqual([]);
    expect(removed.connected).toBe(true); // only the board room is closed, not their session
    expect((await join(removed)).error?.code).toBe("BOARD_NOT_FOUND");
  });

  it("cuts off every socket the removed user has open", async () => {
    const tabA = await watcher(people.member);
    const tabB = await watcher(people.member);
    const a = record(tabA);
    const b = record(tabB);
    await as(people.owner).del(`/api/boards/${boardId}/members/${await memberRowId(people.member)}`);
    await settle();
    a.length = 0;
    b.length = 0;
    await as(people.owner).post(`/api/boards/${boardId}/tasks`, { title: "After removal", columnId: todo });
    await settle();
    expect([a, b]).toEqual([[], []]);
  });
});
