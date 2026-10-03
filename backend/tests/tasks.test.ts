import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { createBoardWithMembers, createColumn, createTask, createUser, resetDatabase } from "./helpers";

const app = createApp();

type Person = { id: string; cookie: string };
const people = {} as Record<"owner" | "admin" | "member" | "viewer" | "outsider", Person>;
let boardId: string;
let todo: string;
let doing: string;
let done: string;

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
  done = (await createColumn(boardId, "Done", 2)).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const send = (method: "post" | "patch", url: string, who: Person, body: unknown) => request(app)[method](url).set("Cookie", who.cookie).send(body as object);
const api = {
  list: (who: Person, id = boardId) => request(app).get(`/api/boards/${id}/tasks`).set("Cookie", who.cookie),
  create: (who: Person, body: unknown, id = boardId) => send("post", `/api/boards/${id}/tasks`, who, body),
  get: (who: Person, id: string) => request(app).get(`/api/tasks/${id}`).set("Cookie", who.cookie),
  update: (who: Person, id: string, body: unknown) => send("patch", `/api/tasks/${id}`, who, body),
  del: (who: Person, id: string) => request(app).delete(`/api/tasks/${id}`).set("Cookie", who.cookie),
  move: (who: Person, id: string, body: unknown) => send("patch", `/api/tasks/${id}/move`, who, body),
  assign: (who: Person, id: string, body: unknown) => send("patch", `/api/tasks/${id}/assign`, who, body),
  board: (who: Person) => request(app).get(`/api/boards/${boardId}`).set("Cookie", who.cookie),
};

/** Seeds tasks into a column at positions 0..n-1; returns ids in order. */
async function seedTasks(columnId: string, titles: string[]) {
  const ids: string[] = [];
  for (let i = 0; i < titles.length; i++) {
    ids.push((await createTask({ boardId, columnId, createdById: people.owner.id, title: titles[i], position: i })).id);
  }
  return ids;
}

async function titlesIn(columnId: string) {
  const tasks = await prisma.task.findMany({ where: { columnId }, orderBy: { position: "asc" } });
  return tasks.map((t) => t.title);
}

/** The invariant everything rests on: in every column, positions are exactly 0..n-1 with no duplicates or gaps. */
async function expectDensePositions(id = boardId) {
  const columns = await prisma.column.findMany({ where: { boardId: id } });
  for (const column of columns) {
    const positions = (await prisma.task.findMany({ where: { columnId: column.id }, select: { position: true } }))
      .map((t) => t.position)
      .sort((a, b) => a - b);
    expect(positions, `positions in column ${column.title}`).toEqual(positions.map((_, i) => i));
  }
}

describe("authentication required", () => {
  it("rejects every task endpoint without a session", async () => {
    const [t] = await seedTasks(todo, ["A"]);
    const results = await Promise.all([
      request(app).get(`/api/boards/${boardId}/tasks`),
      request(app).post(`/api/boards/${boardId}/tasks`).send({ title: "x", columnId: todo }),
      request(app).get(`/api/tasks/${t}`),
      request(app).patch(`/api/tasks/${t}`).send({ title: "x" }),
      request(app).delete(`/api/tasks/${t}`),
      request(app).patch(`/api/tasks/${t}/move`).send({ columnId: doing, position: 0 }),
      request(app).patch(`/api/tasks/${t}/assign`).send({ assigneeId: null }),
    ]);
    for (const res of results) expect(res.status).toBe(401);
    expect(await titlesIn(todo)).toEqual(["A"]);
  });
});

describe("POST /api/boards/:boardId/tasks", () => {
  it("creates a task with defaults, appended to the column, authored by the caller", async () => {
    const res = await api.create(people.member, { title: "Implement authentication", columnId: todo });
    expect(res.status).toBe(201);
    expect(res.body.data.task).toMatchObject({
      boardId,
      columnId: todo,
      title: "Implement authentication",
      description: null,
      priority: "MEDIUM",
      assigneeId: null,
      dueDate: null,
      position: 0,
      createdById: people.member.id,
    });
  });

  it("accepts every field and appends per column independently", async () => {
    const full = await api.create(people.admin, {
      title: "  Padded title ",
      description: " Add JWT authentication ",
      columnId: doing,
      priority: "HIGH",
      assigneeId: people.viewer.id,
      dueDate: "2026-10-15",
    });
    expect(full.status).toBe(201);
    expect(full.body.data.task).toMatchObject({ title: "Padded title", description: "Add JWT authentication", priority: "HIGH", assigneeId: people.viewer.id, dueDate: "2026-10-15", position: 0 });

    const second = await api.create(people.owner, { title: "Two", columnId: doing });
    const otherColumn = await api.create(people.owner, { title: "Elsewhere", columnId: done });
    expect(second.body.data.task.position).toBe(1);
    expect(otherColumn.body.data.task.position).toBe(0);
  });

  it("blank description becomes null", async () => {
    const res = await api.create(people.owner, { title: "T", columnId: todo, description: "   " });
    expect(res.body.data.task.description).toBeNull();
  });

  it("forbids VIEWER (403); outsiders get a 404 identical to an unknown board", async () => {
    expect((await api.create(people.viewer, { title: "x", columnId: todo })).status).toBe(403);
    const outsider = await api.create(people.outsider, { title: "x", columnId: todo });
    const unknown = await api.create(people.outsider, { title: "x", columnId: todo }, "no-such-board");
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(unknown.body);
    expect(await prisma.task.count()).toBe(0);
  });

  it("validates the payload (422)", async () => {
    const bad: unknown[] = [
      {},
      { columnId: todo },
      { title: "x" },
      { title: "   ", columnId: todo },
      { title: "x".repeat(201), columnId: todo },
      { title: "x", columnId: todo, priority: "CRITICAL" },
      { title: "x", columnId: todo, dueDate: "15/10/2026" },
      { title: "x", columnId: todo, dueDate: "2026-02-30" },
      { title: "x", columnId: todo, dueDate: "2026-13-01" },
      { title: "x", columnId: todo, assigneeId: 5 },
      { title: "x", columnId: todo, description: "d".repeat(10001) },
    ];
    for (const body of bad) {
      const res = await api.create(people.owner, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await prisma.task.count()).toBe(0);
  });

  it("rejects a column from another board or a missing column with the same 404", async () => {
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const foreign = (await createColumn(otherBoard, "Foreign", 0)).id;
    const a = await api.create(people.owner, { title: "x", columnId: foreign });
    const b = await api.create(people.owner, { title: "x", columnId: "does-not-exist" });
    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe("COLUMN_NOT_FOUND");
    expect(b.body).toEqual(a.body);
    expect(await prisma.task.count()).toBe(0);
  });

  it("rejects an assignee who is not on the board, whether or not the user exists", async () => {
    const stranger = await api.create(people.owner, { title: "x", columnId: todo, assigneeId: people.outsider.id });
    const ghost = await api.create(people.owner, { title: "x", columnId: todo, assigneeId: "no-such-user" });
    expect(stranger.status).toBe(422);
    expect(stranger.body.error.code).toBe("INVALID_ASSIGNEE");
    expect(ghost.body).toEqual(stranger.body);
    expect(await prisma.task.count()).toBe(0);
  });

  it("ignores client-chosen createdById/boardId/position/id", async () => {
    const res = await api.create(people.member, { title: "x", columnId: todo, createdById: people.owner.id, boardId: "other", position: 42, id: "mine" });
    expect(res.status).toBe(201);
    expect(res.body.data.task).toMatchObject({ createdById: people.member.id, boardId, position: 0 });
    expect(res.body.data.task.id).not.toBe("mine");
  });

  it("gives concurrent creates in one column distinct positions (board lock)", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => api.create(people.owner, { title: `T${i}`, columnId: todo })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    await expectDensePositions();
    expect(await prisma.task.count({ where: { columnId: todo } })).toBe(8);
  });
});

describe("GET /api/boards/:boardId/tasks and GET /api/tasks/:taskId", () => {
  it("lists this board's tasks only, for any member including VIEWER", async () => {
    await seedTasks(todo, ["B", "A"]);
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const otherCol = (await createColumn(otherBoard, "X", 0)).id;
    await createTask({ boardId: otherBoard, columnId: otherCol, createdById: people.owner.id, title: "other board", position: 0 });

    const res = await api.list(people.viewer);
    expect(res.status).toBe(200);
    expect(res.body.data.tasks.map((t: { title: string }) => t.title)).toEqual(["B", "A"]);
    expect((await api.list(people.outsider)).status).toBe(404);
  });

  it("returns task detail with creator and assignee", async () => {
    const created = await api.create(people.member, { title: "Detail", columnId: todo, assigneeId: people.admin.id, dueDate: "2026-10-15" });
    const res = await api.get(people.viewer, created.body.data.task.id);
    expect(res.status).toBe(200);
    expect(res.body.data.task).toMatchObject({
      title: "Detail",
      dueDate: "2026-10-15",
      createdBy: { id: people.member.id, name: "Mia Member" },
      assignee: { id: people.admin.id, name: "Adam Admin" },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|email/);
  });

  it("returns an identical 404 for a task outsiders can't see and one that doesn't exist", async () => {
    const [t] = await seedTasks(todo, ["Secret"]);
    const outsider = await api.get(people.outsider, t);
    const unknown = await api.get(people.outsider, "no-such-task");
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("TASK_NOT_FOUND");
    expect(outsider.body).toEqual(unknown.body);
  });
});

describe("PATCH /api/tasks/:taskId", () => {
  it("lets a MEMBER edit title, description, priority and due date (partial updates)", async () => {
    const [t] = await seedTasks(todo, ["Old"]);
    const res = await api.update(people.member, t, { title: " New ", priority: "URGENT", dueDate: "2026-12-01", description: "Details" });
    expect(res.status).toBe(200);
    expect(res.body.data.task).toMatchObject({ title: "New", priority: "URGENT", dueDate: "2026-12-01", description: "Details", columnId: todo, position: 0 });

    const onlyTitle = await api.update(people.admin, t, { title: "Only title" });
    expect(onlyTitle.body.data.task).toMatchObject({ title: "Only title", priority: "URGENT", dueDate: "2026-12-01" });
  });

  it("clears description and due date with null", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    await api.update(people.owner, t, { description: "x", dueDate: "2026-01-01" });
    const res = await api.update(people.owner, t, { description: null, dueDate: null });
    expect(res.body.data.task).toMatchObject({ description: null, dueDate: null });
  });

  it("cannot move, reassign, re-author or re-home a task", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    const res = await api.update(people.owner, t, { title: "T2", columnId: done, position: 9, boardId: "x", assigneeId: people.member.id, createdById: people.viewer.id });
    expect(res.status).toBe(200);
    expect(res.body.data.task).toMatchObject({ title: "T2", columnId: todo, position: 0, boardId, assigneeId: null, createdById: people.owner.id });
  });

  it("rejects empty and invalid bodies with 422", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    for (const body of [{}, { title: "" }, { priority: "NOPE" }, { dueDate: "tomorrow" }, { columnId: done }]) {
      expect((await api.update(people.owner, t, body)).status, JSON.stringify(body)).toBe(422);
    }
  });

  it("forbids VIEWER (403); outsiders/unknown ids get an identical 404; outsiders never see validation errors", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    expect((await api.update(people.viewer, t, { title: "x" })).status).toBe(403);
    const outsider = await api.update(people.outsider, t, { title: "x" });
    const unknown = await api.update(people.outsider, "no-such-task", { title: "x" });
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(unknown.body);
    expect((await api.update(people.outsider, t, {})).status).toBe(404);
    expect(await titlesIn(todo)).toEqual(["T"]);
  });
});

describe("PATCH /api/tasks/:taskId/assign", () => {
  it("assigns to any board member (including the caller and VIEWERs) and unassigns with null", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    expect((await api.assign(people.member, t, { assigneeId: people.member.id })).body.data.task.assigneeId).toBe(people.member.id);
    expect((await api.assign(people.member, t, { assigneeId: people.viewer.id })).body.data.task.assigneeId).toBe(people.viewer.id);
    expect((await api.assign(people.member, t, { assigneeId: null })).body.data.task.assigneeId).toBeNull();
  });

  it("rejects non-members and unknown users identically (422) and validates the body", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    const stranger = await api.assign(people.owner, t, { assigneeId: people.outsider.id });
    const ghost = await api.assign(people.owner, t, { assigneeId: "no-such-user" });
    expect(stranger.status).toBe(422);
    expect(stranger.body.error.code).toBe("INVALID_ASSIGNEE");
    expect(ghost.body).toEqual(stranger.body);
    expect((await api.assign(people.owner, t, {})).status).toBe(422);
    expect((await api.assign(people.owner, t, { assigneeId: 7 })).status).toBe(422);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).assigneeId).toBeNull();
  });

  it("forbids VIEWER (403) and hides tasks from outsiders (404)", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    expect((await api.assign(people.viewer, t, { assigneeId: people.viewer.id })).status).toBe(403);
    expect((await api.assign(people.outsider, t, { assigneeId: null })).status).toBe(404);
  });
});

describe("DELETE /api/tasks/:taskId", () => {
  it("lets OWNER and ADMIN delete, closing the gap and leaving other columns alone", async () => {
    const [a, b, c] = await seedTasks(todo, ["A", "B", "C"]);
    await seedTasks(doing, ["X", "Y"]);

    const res = await api.del(people.admin, b);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
    expect(await titlesIn(todo)).toEqual(["A", "C"]);
    expect(await titlesIn(doing)).toEqual(["X", "Y"]);
    await expectDensePositions();

    await api.del(people.owner, a).expect(200);
    await api.del(people.owner, c).expect(200);
    expect(await titlesIn(todo)).toEqual([]);
  });

  it("forbids MEMBER and VIEWER (403) per the role matrix; outsiders get 404; second delete 404", async () => {
    const [t] = await seedTasks(todo, ["T"]);
    expect((await api.del(people.member, t)).status).toBe(403);
    expect((await api.del(people.viewer, t)).status).toBe(403);
    expect((await api.del(people.outsider, t)).status).toBe(404);
    expect(await prisma.task.count()).toBe(1);

    await api.del(people.owner, t).expect(200);
    expect((await api.del(people.owner, t)).status).toBe(404);
  });

  it("keeps positions dense under concurrent deletes", async () => {
    const ids = await seedTasks(todo, ["A", "B", "C", "D", "E"]);
    const results = await Promise.all([ids[0], ids[2], ids[4]].map((id) => api.del(people.owner, id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await titlesIn(todo)).toEqual(["B", "D"]);
    await expectDensePositions();
  });
});

describe("PATCH /api/tasks/:taskId/move", () => {
  it("reorders within a column: move last to first", async () => {
    const [, , c] = await seedTasks(todo, ["A", "B", "C"]);
    const res = await api.move(people.member, c, { columnId: todo, position: 0 });
    expect(res.status).toBe(200);
    expect(await titlesIn(todo)).toEqual(["C", "A", "B"]);
    expect(res.body.data.task).toMatchObject({ id: c, columnId: todo, position: 0 });
    expect(res.body.data.columns).toHaveLength(1);
    await expectDensePositions();
  });

  it("reorders within a column: move first to last, and to the middle", async () => {
    const [a, b] = await seedTasks(todo, ["A", "B", "C", "D"]);
    await api.move(people.owner, a, { columnId: todo, position: 3 }).expect(200);
    expect(await titlesIn(todo)).toEqual(["B", "C", "D", "A"]);
    await api.move(people.owner, b, { columnId: todo, position: 2 }).expect(200);
    expect(await titlesIn(todo)).toEqual(["C", "D", "B", "A"]);
    await expectDensePositions();
  });

  it("is a harmless no-op when the task is already at that position", async () => {
    const [, b] = await seedTasks(todo, ["A", "B", "C"]);
    await api.move(people.owner, b, { columnId: todo, position: 1 }).expect(200);
    expect(await titlesIn(todo)).toEqual(["A", "B", "C"]);
  });

  it("moves across columns into the middle, compacting the source and returning both new orders", async () => {
    const [a, b, c] = await seedTasks(todo, ["A", "B", "C"]);
    const [x, y] = await seedTasks(doing, ["X", "Y"]);

    const res = await api.move(people.member, b, { columnId: doing, position: 1 });
    expect(res.status).toBe(200);
    expect(await titlesIn(todo)).toEqual(["A", "C"]);
    expect(await titlesIn(doing)).toEqual(["X", "B", "Y"]);
    await expectDensePositions();

    expect(res.body.data.task).toMatchObject({ id: b, columnId: doing, position: 1, boardId });
    const byColumn = Object.fromEntries(res.body.data.columns.map((c2: { columnId: string; taskIds: string[] }) => [c2.columnId, c2.taskIds]));
    expect(byColumn[doing]).toEqual([x, b, y]);
    expect(byColumn[todo]).toEqual([a, c]);
  });

  it("moves into an empty column and out of the last remaining position", async () => {
    const [only] = await seedTasks(todo, ["Only"]);
    await api.move(people.owner, only, { columnId: done, position: 0 }).expect(200);
    expect(await titlesIn(done)).toEqual(["Only"]);
    expect(await titlesIn(todo)).toEqual([]);
    await expectDensePositions();
  });

  it("clamps a position past the end to 'last' (no gaps)", async () => {
    const [a] = await seedTasks(todo, ["A"]);
    await seedTasks(doing, ["X", "Y"]);
    const res = await api.move(people.owner, a, { columnId: doing, position: 99 });
    expect(res.status).toBe(200);
    expect(res.body.data.task.position).toBe(2);
    expect(await titlesIn(doing)).toEqual(["X", "Y", "A"]);
    await expectDensePositions();
  });

  it("persists: a fresh board read shows the new order and column", async () => {
    const [a, b] = await seedTasks(todo, ["A", "B"]);
    await api.move(people.member, a, { columnId: doing, position: 0 }).expect(200);
    await api.move(people.member, b, { columnId: doing, position: 0 }).expect(200);
    const board = (await api.board(people.viewer)).body.data.board;
    const inDoing = board.tasks.filter((t: { columnId: string }) => t.columnId === doing).sort((p: { position: number }, q: { position: number }) => p.position - q.position);
    expect(inDoing.map((t: { title: string }) => t.title)).toEqual(["B", "A"]);
  });

  it("rejects invalid positions with 422", async () => {
    const [a] = await seedTasks(todo, ["A"]);
    for (const body of [{ columnId: todo }, { columnId: todo, position: -1 }, { columnId: todo, position: 1.5 }, { columnId: todo, position: "0" }, { position: 0 }, {}]) {
      expect((await api.move(people.owner, a, body)).status, JSON.stringify(body)).toBe(422);
    }
  });

  it("rejects a target column from another board or a missing one with the same 404, changing nothing", async () => {
    const [a, b] = await seedTasks(todo, ["A", "B"]);
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const foreign = (await createColumn(otherBoard, "Foreign", 0)).id;

    const r1 = await api.move(people.owner, a, { columnId: foreign, position: 0 });
    const r2 = await api.move(people.owner, a, { columnId: "nope", position: 0 });
    expect(r1.status).toBe(404);
    expect(r1.body.error.code).toBe("COLUMN_NOT_FOUND");
    expect(r2.body).toEqual(r1.body);
    expect(await titlesIn(todo)).toEqual(["A", "B"]);
    expect(await prisma.task.count({ where: { columnId: foreign } })).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b } })).boardId).toBe(boardId);
  });

  it("allows MEMBER, forbids VIEWER (403), hides tasks from outsiders (404)", async () => {
    const [a] = await seedTasks(todo, ["A"]);
    expect((await api.move(people.viewer, a, { columnId: doing, position: 0 })).status).toBe(403);
    expect((await api.move(people.outsider, a, { columnId: doing, position: 0 })).status).toBe(404);
    expect(await titlesIn(todo)).toEqual(["A"]);
    expect((await api.move(people.member, a, { columnId: doing, position: 0 })).status).toBe(200);
  });

  it("keeps every column dense when many tasks move into the same column concurrently", async () => {
    const ids = await seedTasks(todo, ["A", "B", "C", "D", "E", "F"]);
    await seedTasks(doing, ["X", "Y"]);
    const results = await Promise.all(ids.map((id, i) => api.move(people.member, id, { columnId: doing, position: i % 3 })));
    expect(results.every((r) => r.status === 200)).toBe(true);

    expect(await prisma.task.count({ where: { columnId: doing } })).toBe(8);
    expect(await prisma.task.count({ where: { columnId: todo } })).toBe(0);
    await expectDensePositions();
    const all = await prisma.task.findMany({ where: { boardId }, select: { id: true } });
    expect(new Set(all.map((t) => t.id)).size).toBe(8); // nothing lost or duplicated
  });

  it("keeps positions dense under mixed concurrent moves and deletes", async () => {
    const [a, b, c, d] = await seedTasks(todo, ["A", "B", "C", "D"]);
    const [x] = await seedTasks(doing, ["X"]);
    const results = await Promise.all([
      api.move(people.owner, a, { columnId: doing, position: 0 }),
      api.del(people.owner, b),
      api.move(people.owner, c, { columnId: todo, position: 0 }),
      api.move(people.owner, x, { columnId: done, position: 0 }),
      api.del(people.owner, d),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    await expectDensePositions();
    expect(await prisma.task.count({ where: { boardId } })).toBe(3);
  });
});
