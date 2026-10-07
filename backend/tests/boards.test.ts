import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import { createBoardWithMembers, createColumn, createTask, createUser, resetDatabase } from "./helpers";

const app = createApp();

type Person = { id: string; cookie: string };
let alice: Person; // owner of most boards
let bob: Person;
let carol: Person;

beforeEach(async () => {
  await resetDatabase();
  alice = await createUser("Alice Owner");
  bob = await createUser("Bob Builder");
  carol = await createUser("Carol Outsider");
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = {
  list: (who: Person) => request(app).get("/api/boards").set("Cookie", who.cookie),
  create: (who: Person, body: unknown) => request(app).post("/api/boards").set("Cookie", who.cookie).send(body as object),
  get: (who: Person, id: string) => request(app).get(`/api/boards/${id}`).set("Cookie", who.cookie),
  patch: (who: Person, id: string, body: unknown) =>
    request(app).patch(`/api/boards/${id}`).set("Cookie", who.cookie).send(body as object),
  del: (who: Person, id: string) => request(app).delete(`/api/boards/${id}`).set("Cookie", who.cookie),
};

describe("authentication required", () => {
  it("rejects every board endpoint without a session", async () => {
    const id = await createBoardWithMembers(alice.id);
    const calls = [
      request(app).get("/api/boards"),
      request(app).post("/api/boards").send({ name: "x" }),
      request(app).get(`/api/boards/${id}`),
      request(app).patch(`/api/boards/${id}`).send({ name: "x" }),
      request(app).delete(`/api/boards/${id}`),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
    expect(await prisma.board.count()).toBe(1);
  });
});

describe("POST /api/boards", () => {
  it("creates the board and makes the creator OWNER", async () => {
    const res = await api.create(alice, { name: "Internship Project", description: "Sprint tracker" });

    expect(res.status).toBe(201);
    expect(res.body.data.board).toMatchObject({
      name: "Internship Project",
      description: "Sprint tracker",
      ownerId: alice.id,
      myRole: "OWNER",
      memberCount: 1,
      taskCount: 0,
    });

    const members = await prisma.boardMember.findMany({ where: { boardId: res.body.data.board.id } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: alice.id, role: "OWNER" });
  });

  it("trims the name, stores blank description as null, and does not require a description", async () => {
    const a = await api.create(alice, { name: "  Spaced  ", description: "   " });
    expect(a.body.data.board).toMatchObject({ name: "Spaced", description: null });
    const b = await api.create(alice, { name: "No description" });
    expect(b.body.data.board.description).toBeNull();
  });

  it("ignores client-supplied ownerId/id (the owner is always the caller)", async () => {
    const res = await api.create(alice, { name: "Mine", ownerId: bob.id, id: "chosen-id" });
    expect(res.status).toBe(201);
    expect(res.body.data.board.ownerId).toBe(alice.id);
    expect(res.body.data.board.id).not.toBe("chosen-id");
  });

  it("validates input with 422", async () => {
    for (const body of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(101) }, { name: "ok", description: "y".repeat(2001) }, { name: 5 }]) {
      const res = await api.create(alice, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.board.count()).toBe(0);
  });
});

describe("GET /api/boards", () => {
  it("lists only boards the caller belongs to, with role and counts", async () => {
    const owned = await createBoardWithMembers(alice.id, [{ userId: bob.id, role: "MEMBER" }]);
    const col = await createColumn(owned, "Todo", 0);
    await createTask({ boardId: owned, columnId: col.id, createdById: alice.id, title: "T1", position: 0 });
    await createTask({ boardId: owned, columnId: col.id, createdById: alice.id, title: "T2", position: 1 });
    const bobsOwn = await createBoardWithMembers(bob.id);
    const carolsPrivate = await createBoardWithMembers(carol.id);

    const forBob = await api.list(bob);
    expect(forBob.status).toBe(200);
    const byId = Object.fromEntries(forBob.body.data.boards.map((b: { id: string }) => [b.id, b]));
    expect(Object.keys(byId).sort()).toEqual([owned, bobsOwn].sort());
    expect(byId[owned]).toMatchObject({ myRole: "MEMBER", memberCount: 2, taskCount: 2 });
    expect(byId[bobsOwn]).toMatchObject({ myRole: "OWNER", memberCount: 1, taskCount: 0 });
    expect(byId[carolsPrivate]).toBeUndefined();

    const forCarol = await api.list(carol);
    expect(forCarol.body.data.boards.map((b: { id: string }) => b.id)).toEqual([carolsPrivate]);
  });

  it("returns an empty list for a user with no boards", async () => {
    const res = await api.list(carol);
    expect(res.status).toBe(200);
    expect(res.body.data.boards).toEqual([]);
  });

  it("orders by most recently updated", async () => {
    const first = (await api.create(alice, { name: "First" })).body.data.board.id;
    const second = (await api.create(alice, { name: "Second" })).body.data.board.id;
    expect((await api.list(alice)).body.data.boards.map((b: { id: string }) => b.id)).toEqual([second, first]);

    await api.patch(alice, first, { name: "First (renamed)" });
    expect((await api.list(alice)).body.data.boards.map((b: { id: string }) => b.id)).toEqual([first, second]);
  });
});

describe("GET /api/boards/:boardId", () => {
  it("returns members, ordered columns and tasks, and the caller's role", async () => {
    const boardId = await createBoardWithMembers(alice.id, [
      { userId: bob.id, role: "VIEWER" },
    ]);
    // Inserted in an order that is neither ascending nor descending by position, so neither
    // insertion order nor reverse-creation order can accidentally satisfy the ordering assertions.
    await createColumn(boardId, "Review", 1);
    const done = await createColumn(boardId, "Done", 2);
    const todo = await createColumn(boardId, "Todo", 0);
    await createTask({ boardId, columnId: todo.id, createdById: alice.id, title: "Second", position: 1, priority: "HIGH", dueDate: "2026-10-15", assigneeId: bob.id });
    await createTask({ boardId, columnId: todo.id, createdById: alice.id, title: "Third", position: 2 });
    await createTask({ boardId, columnId: todo.id, createdById: alice.id, title: "First", position: 0 });
    await createTask({ boardId, columnId: done.id, createdById: alice.id, title: "Shipped", position: 0 });

    const res = await api.get(bob, boardId); // a VIEWER may read
    expect(res.status).toBe(200);
    const board = res.body.data.board;

    expect(board).toMatchObject({ id: boardId, ownerId: alice.id, myRole: "VIEWER", myPermissions: ["board:view"] });
    const asOwner = (await api.get(alice, boardId)).body.data.board;
    expect(asOwner.myPermissions).toEqual(expect.arrayContaining(["board:view", "board:delete", "task:move", "member:manage"]));
    expect(asOwner.myPermissions).toHaveLength(13);
    expect(board.columns.map((c: { title: string }) => c.title)).toEqual(["Todo", "Review", "Done"]);
    expect(board.tasks.filter((t: { columnId: string }) => t.columnId === todo.id).map((t: { title: string }) => t.title)).toEqual(["First", "Second", "Third"]);

    const second = board.tasks.find((t: { title: string }) => t.title === "Second");
    expect(second).toMatchObject({ priority: "HIGH", dueDate: "2026-10-15", assigneeId: bob.id, createdById: alice.id });
    expect(board.tasks.find((t: { title: string }) => t.title === "First")).toMatchObject({ priority: "MEDIUM", dueDate: null, assigneeId: null });

    expect(board.members).toHaveLength(2);
    expect(board.members.map((m: { role: string }) => m.role).sort()).toEqual(["OWNER", "VIEWER"]);
    expect(board.members[0].user).toEqual({ id: expect.any(String), name: expect.any(String), email: expect.any(String), avatar: null });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it("returns an empty board (no columns/tasks) as empty arrays", async () => {
    const boardId = (await api.create(alice, { name: "Empty" })).body.data.board.id;
    const res = await api.get(alice, boardId);
    expect(res.status).toBe(200);
    expect(res.body.data.board).toMatchObject({ columns: [], tasks: [] });
  });

  it("404s for non-members and for unknown ids, with identical bodies", async () => {
    const boardId = await createBoardWithMembers(alice.id);
    const outsider = await api.get(carol, boardId);
    const unknown = await api.get(carol, "does-not-exist");
    expect(outsider.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(outsider.body).toEqual(unknown.body);
  });
});

describe("PATCH /api/boards/:boardId", () => {
  it("lets the OWNER rename and re-describe the board", async () => {
    const boardId = (await api.create(alice, { name: "Old", description: "old desc" })).body.data.board.id;
    const before = await prisma.board.findUniqueOrThrow({ where: { id: boardId } });

    const res = await api.patch(alice, boardId, { name: "  New name ", description: "new desc" });
    expect(res.status).toBe(200);
    expect(res.body.data.board).toMatchObject({ name: "New name", description: "new desc", myRole: "OWNER" });

    const after = await prisma.board.findUniqueOrThrow({ where: { id: boardId } });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it("supports partial updates and clearing the description with null", async () => {
    const boardId = (await api.create(alice, { name: "Keep me", description: "clear me" })).body.data.board.id;

    const onlyDesc = await api.patch(alice, boardId, { description: null });
    expect(onlyDesc.body.data.board).toMatchObject({ name: "Keep me", description: null });

    const onlyName = await api.patch(alice, boardId, { name: "Renamed" });
    expect(onlyName.body.data.board).toMatchObject({ name: "Renamed", description: null });
  });

  it("rejects an empty body, bad values, and cannot change the owner", async () => {
    const boardId = (await api.create(alice, { name: "B" })).body.data.board.id;
    for (const body of [{}, { name: "" }, { name: "x".repeat(101) }]) {
      expect((await api.patch(alice, boardId, body)).status).toBe(422);
    }
    const sneaky = await api.patch(alice, boardId, { name: "B2", ownerId: bob.id });
    expect(sneaky.status).toBe(200);
    expect((await prisma.board.findUniqueOrThrow({ where: { id: boardId } })).ownerId).toBe(alice.id);
  });

  it("forbids ADMIN, MEMBER and VIEWER (403) and hides the board from outsiders (404)", async () => {
    const admin = bob;
    const viewer = carol;
    const member = await createUser("Mia Member");
    const outsider = await createUser("Otto Outsider");
    const boardId = await createBoardWithMembers(alice.id, [
      { userId: admin.id, role: "ADMIN" },
      { userId: member.id, role: "MEMBER" },
      { userId: viewer.id, role: "VIEWER" },
    ]);

    for (const who of [admin, member, viewer]) expect((await api.patch(who, boardId, { name: "Hacked" })).status).toBe(403);
    expect((await api.patch(outsider, boardId, { name: "Hacked" })).status).toBe(404);
    expect((await prisma.board.findUniqueOrThrow({ where: { id: boardId } })).name).toBe("Test board");
  });

  it("outsiders get 404 even with an invalid body (authorization runs before validation)", async () => {
    const boardId = await createBoardWithMembers(alice.id);
    expect((await api.patch(carol, boardId, {})).status).toBe(404);
  });
});

describe("DELETE /api/boards/:boardId", () => {
  it("lets the OWNER delete the board and cascades to members, columns and tasks only for that board", async () => {
    const doomed = await createBoardWithMembers(alice.id, [{ userId: bob.id, role: "MEMBER" }]);
    const col = await createColumn(doomed, "Todo", 0);
    await createTask({ boardId: doomed, columnId: col.id, createdById: alice.id, title: "T", position: 0 });
    const survivor = await createBoardWithMembers(alice.id);
    const survivorCol = await createColumn(survivor, "Keep", 0);
    await createTask({ boardId: survivor, columnId: survivorCol.id, createdById: alice.id, title: "K", position: 0 });

    const res = await api.del(alice, doomed);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });

    expect(await prisma.board.count({ where: { id: doomed } })).toBe(0);
    expect(await prisma.boardMember.count({ where: { boardId: doomed } })).toBe(0);
    expect(await prisma.column.count({ where: { boardId: doomed } })).toBe(0);
    expect(await prisma.task.count({ where: { boardId: doomed } })).toBe(0);

    expect(await prisma.board.count({ where: { id: survivor } })).toBe(1);
    expect(await prisma.column.count({ where: { boardId: survivor } })).toBe(1);
    expect(await prisma.task.count({ where: { boardId: survivor } })).toBe(1);
    expect(await prisma.user.count()).toBe(3); // users untouched

    expect((await api.get(alice, doomed)).status).toBe(404);
  });

  it("forbids non-owners and hides the board from outsiders; nothing is deleted", async () => {
    const admin = bob;
    const outsider = carol;
    const boardId = await createBoardWithMembers(alice.id, [{ userId: admin.id, role: "ADMIN" }]);

    expect((await api.del(admin, boardId)).status).toBe(403);
    expect((await api.del(outsider, boardId)).status).toBe(404);
    expect(await prisma.board.count({ where: { id: boardId } })).toBe(1);
  });

  it("returns 404 when deleting twice", async () => {
    const boardId = (await api.create(alice, { name: "Once" })).body.data.board.id;
    await api.del(alice, boardId).expect(200);
    expect((await api.del(alice, boardId)).status).toBe(404);
  });
});

describe("cross-user isolation", () => {
  it("a user can neither read, change nor delete another user's private board", async () => {
    const aliceBoard = (await api.create(alice, { name: "Alice private" })).body.data.board.id;

    expect((await api.get(bob, aliceBoard)).status).toBe(404);
    expect((await api.patch(bob, aliceBoard, { name: "mine now" })).status).toBe(404);
    expect((await api.del(bob, aliceBoard)).status).toBe(404);
    expect((await api.list(bob)).body.data.boards).toEqual([]);

    expect(await prisma.board.findUniqueOrThrow({ where: { id: aliceBoard } })).toMatchObject({ name: "Alice private", ownerId: alice.id });
  });
});
