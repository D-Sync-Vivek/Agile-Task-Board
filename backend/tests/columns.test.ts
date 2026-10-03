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
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = {
  create: (who: Person, id: string, body: unknown) => request(app).post(`/api/boards/${id}/columns`).set("Cookie", who.cookie).send(body as object),
  rename: (who: Person, columnId: string, body: unknown) => request(app).patch(`/api/columns/${columnId}`).set("Cookie", who.cookie).send(body as object),
  del: (who: Person, columnId: string) => request(app).delete(`/api/columns/${columnId}`).set("Cookie", who.cookie),
  reorder: (who: Person, id: string, body: unknown) => request(app).patch(`/api/boards/${id}/columns/reorder`).set("Cookie", who.cookie).send(body as object),
  board: (who: Person, id: string) => request(app).get(`/api/boards/${id}`).set("Cookie", who.cookie),
};

/** Seeds columns "A","B","C"... at positions 0..n-1 and returns their ids in order. */
async function seedColumns(id: string, titles: string[]) {
  const ids: string[] = [];
  for (let i = 0; i < titles.length; i++) ids.push((await createColumn(id, titles[i], i)).id);
  return ids;
}

async function dbOrder(id: string) {
  const cols = await prisma.column.findMany({ where: { boardId: id }, orderBy: { position: "asc" } });
  return { titles: cols.map((c) => c.title), positions: cols.map((c) => c.position), ids: cols.map((c) => c.id) };
}

describe("authentication required", () => {
  it("rejects all column endpoints without a session", async () => {
    const [col] = await seedColumns(boardId, ["A"]);
    const results = await Promise.all([
      request(app).post(`/api/boards/${boardId}/columns`).send({ title: "x" }),
      request(app).patch(`/api/boards/${boardId}/columns/reorder`).send({ columnIds: [col] }),
      request(app).patch(`/api/columns/${col}`).send({ title: "x" }),
      request(app).delete(`/api/columns/${col}`),
    ]);
    for (const res of results) expect(res.status).toBe(401);
    expect((await dbOrder(boardId)).titles).toEqual(["A"]);
  });
});

describe("POST /api/boards/:boardId/columns", () => {
  it("lets OWNER and ADMIN create columns, appended at the end", async () => {
    const a = await api.create(people.owner, boardId, { title: "Todo" });
    const b = await api.create(people.admin, boardId, { title: "Doing" });
    const c = await api.create(people.owner, boardId, { title: "Done" });

    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(a.body.data.column).toMatchObject({ boardId, title: "Todo", position: 0 });
    expect(b.body.data.column.position).toBe(1);
    expect(c.body.data.column.position).toBe(2);
    expect((await dbOrder(boardId)).titles).toEqual(["Todo", "Doing", "Done"]);
  });

  it("forbids MEMBER and VIEWER (403) and hides the board from outsiders (404)", async () => {
    expect((await api.create(people.member, boardId, { title: "x" })).status).toBe(403);
    expect((await api.create(people.viewer, boardId, { title: "x" })).status).toBe(403);
    const outsider = await api.create(people.outsider, boardId, { title: "x" });
    const unknownBoard = await api.create(people.outsider, "no-such-board", { title: "x" });
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(unknownBoard.body);
    expect(await prisma.column.count()).toBe(0);
  });

  it("trims the title, validates it (422), and ignores client-chosen position/boardId/id", async () => {
    const ok = await api.create(people.owner, boardId, { title: "  Padded  ", position: 99, boardId: "other", id: "mine" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.column).toMatchObject({ title: "Padded", position: 0, boardId });
    expect(ok.body.data.column.id).not.toBe("mine");

    for (const body of [{}, { title: "" }, { title: "   " }, { title: "x".repeat(101) }, { title: 7 }]) {
      expect((await api.create(people.owner, boardId, body)).status).toBe(422);
    }
    expect(await prisma.column.count()).toBe(1);
  });

  it("gives every column a distinct position when created concurrently (board lock)", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => api.create(people.owner, boardId, { title: `C${i}` })));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const { positions } = await dbOrder(boardId);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("PATCH /api/columns/:columnId (rename)", () => {
  it("lets OWNER and ADMIN rename, without touching position", async () => {
    const [, b] = await seedColumns(boardId, ["A", "B"]);
    const r1 = await api.rename(people.admin, b, { title: "  Renamed " });
    expect(r1.status).toBe(200);
    expect(r1.body.data.column).toMatchObject({ id: b, title: "Renamed", position: 1 });
    expect((await api.rename(people.owner, b, { title: "Again" })).status).toBe(200);
  });

  it("cannot be used to move a column or change its board", async () => {
    const [a] = await seedColumns(boardId, ["A", "B"]);
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const res = await api.rename(people.owner, a, { title: "A2", position: 5, boardId: otherBoard });
    expect(res.status).toBe(200);
    expect(res.body.data.column).toMatchObject({ title: "A2", position: 0, boardId });
  });

  it("forbids MEMBER/VIEWER (403); outsiders and unknown ids get an identical 404", async () => {
    const [a] = await seedColumns(boardId, ["A"]);
    expect((await api.rename(people.member, a, { title: "x" })).status).toBe(403);
    expect((await api.rename(people.viewer, a, { title: "x" })).status).toBe(403);

    const outsider = await api.rename(people.outsider, a, { title: "x" });
    const unknown = await api.rename(people.outsider, "no-such-column", { title: "x" });
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("COLUMN_NOT_FOUND");
    expect(outsider.body).toEqual(unknown.body); // can't probe which column ids exist
    expect((await dbOrder(boardId)).titles).toEqual(["A"]);
  });

  it("validates the title (422) after authorization", async () => {
    const [a] = await seedColumns(boardId, ["A"]);
    expect((await api.rename(people.owner, a, { title: "" })).status).toBe(422);
    expect((await api.rename(people.owner, a, {})).status).toBe(422);
    expect((await api.rename(people.outsider, a, {})).status).toBe(404); // not 422: outsiders learn nothing
  });
});

describe("DELETE /api/columns/:columnId", () => {
  it("deletes the column and its tasks only, and closes the gap in positions", async () => {
    const [a, b, c] = await seedColumns(boardId, ["A", "B", "C"]);
    await createTask({ boardId, columnId: a, createdById: people.owner.id, title: "in A", position: 0 });
    await createTask({ boardId, columnId: b, createdById: people.owner.id, title: "in B 1", position: 0 });
    await createTask({ boardId, columnId: b, createdById: people.owner.id, title: "in B 2", position: 1 });
    await createTask({ boardId, columnId: c, createdById: people.owner.id, title: "in C", position: 0 });
    const otherBoard = await createBoardWithMembers(people.owner.id);
    await seedColumns(otherBoard, ["X", "Y"]);

    const res = await api.del(people.admin, b);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });

    const after = await dbOrder(boardId);
    expect(after.titles).toEqual(["A", "C"]);
    expect(after.positions).toEqual([0, 1]); // dense again
    const tasks = await prisma.task.findMany({ where: { boardId }, orderBy: { title: "asc" } });
    expect(tasks.map((t) => t.title)).toEqual(["in A", "in C"]);
    expect((await dbOrder(otherBoard)).positions).toEqual([0, 1]); // other board untouched
  });

  it("works for the first and last column and for the only column", async () => {
    const [a, , c] = await seedColumns(boardId, ["A", "B", "C"]);
    await api.del(people.owner, a).expect(200);
    expect(await dbOrder(boardId)).toMatchObject({ titles: ["B", "C"], positions: [0, 1] });
    await api.del(people.owner, c).expect(200);
    expect(await dbOrder(boardId)).toMatchObject({ titles: ["B"], positions: [0] });
    const [only] = (await dbOrder(boardId)).ids;
    await api.del(people.owner, only).expect(200);
    expect((await api.board(people.owner, boardId)).body.data.board.columns).toEqual([]);
  });

  it("forbids MEMBER/VIEWER (403); outsiders get 404; second delete is 404", async () => {
    const [a] = await seedColumns(boardId, ["A"]);
    expect((await api.del(people.member, a)).status).toBe(403);
    expect((await api.del(people.viewer, a)).status).toBe(403);
    expect((await api.del(people.outsider, a)).status).toBe(404);
    expect(await prisma.column.count()).toBe(1);

    await api.del(people.owner, a).expect(200);
    expect((await api.del(people.owner, a)).status).toBe(404);
  });

  it("keeps positions dense when columns are deleted concurrently", async () => {
    const ids = await seedColumns(boardId, ["A", "B", "C", "D", "E"]);
    const results = await Promise.all([ids[0], ids[2], ids[4]].map((id) => api.del(people.owner, id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await dbOrder(boardId)).toMatchObject({ titles: ["B", "D"], positions: [0, 1] });
  });
});

describe("PATCH /api/boards/:boardId/columns/reorder", () => {
  it("persists the new order, returns it, and it survives a reload", async () => {
    const [a, b, c, d] = await seedColumns(boardId, ["A", "B", "C", "D"]);

    const res = await api.reorder(people.admin, boardId, { columnIds: [d, a, c, b] });
    expect(res.status).toBe(200);
    expect(res.body.data.columns.map((x: { title: string }) => x.title)).toEqual(["D", "A", "C", "B"]);
    expect(res.body.data.columns.map((x: { position: number }) => x.position)).toEqual([0, 1, 2, 3]);

    // "refresh": a fresh read through the board endpoint, by another member
    const reloaded = await api.board(people.viewer, boardId);
    expect(reloaded.body.data.board.columns.map((x: { title: string }) => x.title)).toEqual(["D", "A", "C", "B"]);
    expect((await dbOrder(boardId)).positions).toEqual([0, 1, 2, 3]);
  });

  it("is a no-op for an unchanged order and works for a single column", async () => {
    const [a, b] = await seedColumns(boardId, ["A", "B"]);
    const same = await api.reorder(people.owner, boardId, { columnIds: [a, b] });
    expect(same.status).toBe(200);
    expect((await dbOrder(boardId)).titles).toEqual(["A", "B"]);

    await api.del(people.owner, b).expect(200);
    expect((await api.reorder(people.owner, boardId, { columnIds: [a] })).status).toBe(200);
  });

  it("rejects an incomplete, stale or foreign list with 409 and writes NOTHING", async () => {
    const [a, b, c] = await seedColumns(boardId, ["A", "B", "C"]);
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const [foreign] = await seedColumns(otherBoard, ["X"]);

    const cases = [
      { columnIds: [c, a] }, // missing b
      { columnIds: [c, b, a, foreign] }, // extra id
      { columnIds: [c, b, foreign] }, // foreign id replacing a
      { columnIds: [c, b, "does-not-exist"] },
    ];
    for (const body of cases) {
      const res = await api.reorder(people.owner, boardId, body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(res.body.error.code).toBe("COLUMN_LIST_OUT_OF_DATE");
      expect(await dbOrder(boardId)).toMatchObject({ titles: ["A", "B", "C"], positions: [0, 1, 2] });
    }
    expect((await dbOrder(otherBoard)).titles).toEqual(["X"]);
  });

  it("returns 409 for a list that predates a concurrent delete", async () => {
    const [a, b, c] = await seedColumns(boardId, ["A", "B", "C"]);
    await api.del(people.owner, b).expect(200);
    const stale = await api.reorder(people.owner, boardId, { columnIds: [c, b, a] });
    expect(stale.status).toBe(409);
    expect((await dbOrder(boardId)).titles).toEqual(["A", "C"]);
  });

  it("validates the payload (422): empty, duplicates, wrong types, missing key", async () => {
    const [a, b] = await seedColumns(boardId, ["A", "B"]);
    for (const body of [{}, { columnIds: [] }, { columnIds: [a, a] }, { columnIds: [a, 5] }, { columnIds: "A,B" }, { columnIds: [a, ""] }]) {
      const res = await api.reorder(people.owner, boardId, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await dbOrder(boardId)).ids).toEqual([a, b]);
  });

  it("forbids MEMBER/VIEWER (403) and hides the board from outsiders (404)", async () => {
    const [a, b] = await seedColumns(boardId, ["A", "B"]);
    expect((await api.reorder(people.member, boardId, { columnIds: [b, a] })).status).toBe(403);
    expect((await api.reorder(people.viewer, boardId, { columnIds: [b, a] })).status).toBe(403);
    expect((await api.reorder(people.outsider, boardId, { columnIds: [b, a] })).status).toBe(404);
    expect((await dbOrder(boardId)).titles).toEqual(["A", "B"]);
  });

  it("concurrent reorders serialise: the result is always one of the requested orders, never a mix", async () => {
    const [a, b, c, d] = await seedColumns(boardId, ["A", "B", "C", "D"]);
    const first = [d, c, b, a];
    const second = [b, d, a, c];

    const results = await Promise.all([api.reorder(people.owner, boardId, { columnIds: first }), api.reorder(people.admin, boardId, { columnIds: second })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);

    const final = await dbOrder(boardId);
    expect(final.positions).toEqual([0, 1, 2, 3]); // no duplicates / gaps
    expect([first, second]).toContainEqual(final.ids);
  });
});
