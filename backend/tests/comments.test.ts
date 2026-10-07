import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { createBoardWithMembers, createColumn, createComment, createTask, createUser, resetDatabase } from "./helpers";

const app = createApp();

type Person = { id: string; cookie: string };
const people = {} as Record<"owner" | "admin" | "member" | "member2" | "viewer" | "outsider", Person>;
let boardId: string;
let taskId: string;
let otherTaskId: string;

beforeEach(async () => {
  await resetDatabase();
  people.owner = await createUser("Olivia Owner");
  people.admin = await createUser("Adam Admin");
  people.member = await createUser("Mia Member");
  people.member2 = await createUser("Max Member");
  people.viewer = await createUser("Victor Viewer");
  people.outsider = await createUser("Otto Outsider");
  boardId = await createBoardWithMembers(people.owner.id, [
    { userId: people.admin.id, role: "ADMIN" as BoardRole },
    { userId: people.member.id, role: "MEMBER" as BoardRole },
    { userId: people.member2.id, role: "MEMBER" as BoardRole },
    { userId: people.viewer.id, role: "VIEWER" as BoardRole },
  ]);
  const column = await createColumn(boardId, "Todo", 0);
  taskId = (await createTask({ boardId, columnId: column.id, createdById: people.owner.id, title: "Task", position: 0 })).id;
  otherTaskId = (await createTask({ boardId, columnId: column.id, createdById: people.owner.id, title: "Other", position: 1 })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = {
  list: (who: Person, id = taskId) => request(app).get(`/api/tasks/${id}/comments`).set("Cookie", who.cookie),
  create: (who: Person, body: unknown, id = taskId) => request(app).post(`/api/tasks/${id}/comments`).set("Cookie", who.cookie).send(body as object),
  edit: (who: Person, commentId: string, body: unknown) => request(app).patch(`/api/comments/${commentId}`).set("Cookie", who.cookie).send(body as object),
  del: (who: Person, commentId: string) => request(app).delete(`/api/comments/${commentId}`).set("Cookie", who.cookie),
};

const count = () => prisma.comment.count();

describe("authentication required", () => {
  it("rejects every comment endpoint without a session", async () => {
    const c = await createComment(taskId, people.member.id, "hello");
    const results = await Promise.all([
      request(app).get(`/api/tasks/${taskId}/comments`),
      request(app).post(`/api/tasks/${taskId}/comments`).send({ content: "x" }),
      request(app).patch(`/api/comments/${c.id}`).send({ content: "x" }),
      request(app).delete(`/api/comments/${c.id}`),
    ]);
    for (const res of results) expect(res.status).toBe(401);
    expect(await count()).toBe(1);
  });
});

describe("GET /api/tasks/:taskId/comments", () => {
  it("lists a task's comments oldest first, with author info, for any member including VIEWER", async () => {
    await createComment(taskId, people.member.id, "second", new Date("2026-10-04T10:05:00Z"));
    await createComment(taskId, people.owner.id, "first", new Date("2026-10-04T10:00:00Z"));
    await createComment(otherTaskId, people.member.id, "different task");

    const res = await api.list(people.viewer);
    expect(res.status).toBe(200);
    expect(res.body.data.comments.map((c: { content: string }) => c.content)).toEqual(["first", "second"]);
    expect(res.body.data.comments[0]).toMatchObject({ taskId, userId: people.owner.id, author: { id: people.owner.id, name: "Olivia Owner", avatar: null }, edited: false });
  });

  it("never exposes emails or password hashes", async () => {
    await createComment(taskId, people.member.id, "hi");
    const body = JSON.stringify((await api.list(people.owner)).body);
    expect(body).not.toMatch(/email|passwordHash|@example\.com/);
  });

  it("returns an empty list for a task without comments", async () => {
    expect((await api.list(people.member)).body.data.comments).toEqual([]);
  });

  it("gives outsiders the same 404 as for a task that doesn't exist", async () => {
    await createComment(taskId, people.member.id, "secret");
    const outsider = await api.list(people.outsider);
    const unknown = await api.list(people.outsider, "no-such-task");
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("TASK_NOT_FOUND");
    expect(outsider.body).toEqual(unknown.body);
  });
});

describe("POST /api/tasks/:taskId/comments", () => {
  it.each(["owner", "admin", "member"] as const)("lets %s comment; the author is always the caller", async (who) => {
    const res = await api.create(people[who], { content: "Can we move this to the next sprint?" });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toMatchObject({
      taskId,
      userId: people[who].id,
      content: "Can we move this to the next sprint?",
      edited: false,
      author: { id: people[who].id },
    });
    expect(res.body.data.comment.createdAt).toBe(res.body.data.comment.updatedAt);
  });

  it("forbids VIEWER (403) and hides the task from outsiders (404)", async () => {
    expect((await api.create(people.viewer, { content: "x" })).status).toBe(403);
    const outsider = await api.create(people.outsider, { content: "x" });
    const unknown = await api.create(people.outsider, { content: "x" }, "no-such-task");
    expect(outsider.status).toBe(404);
    expect(outsider.body).toEqual(unknown.body);
    expect(await count()).toBe(0);
  });

  it("trims the content and validates it (422)", async () => {
    const ok = await api.create(people.member, { content: "  padded  " });
    expect(ok.body.data.comment.content).toBe("padded");

    for (const body of [{}, { content: "" }, { content: "   \n " }, { content: "x".repeat(5001) }, { content: 5 }, { content: null }]) {
      const res = await api.create(people.member, body);
      expect(res.status, JSON.stringify(body).slice(0, 30)).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await count()).toBe(1);
    expect((await api.create(people.member, { content: "x".repeat(5000) })).status).toBe(201); // the limit is inclusive
  });

  it("ignores client-chosen author, task, id and timestamps", async () => {
    const res = await api.create(people.member, { content: "hi", userId: people.owner.id, taskId: otherTaskId, id: "mine", createdAt: "2001-01-01T00:00:00Z" });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toMatchObject({ userId: people.member.id, taskId });
    expect(res.body.data.comment.id).not.toBe("mine");
    expect(new Date(res.body.data.comment.createdAt).getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("handles simultaneous comments", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => api.create(i % 2 ? people.member : people.member2, { content: `c${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await count()).toBe(6);
  });
});

describe("PATCH /api/comments/:commentId (edit: author only)", () => {
  it("lets the author edit their comment, which then reads as edited", async () => {
    const c = await createComment(taskId, people.member.id, "original", new Date("2026-10-04T10:00:00Z"));
    const res = await api.edit(people.member, c.id, { content: "  corrected  " });
    expect(res.status).toBe(200);
    expect(res.body.data.comment).toMatchObject({ id: c.id, content: "corrected", edited: true, author: { id: people.member.id } });
    expect(new Date(res.body.data.comment.updatedAt).getTime()).toBeGreaterThan(new Date(res.body.data.comment.createdAt).getTime());
    expect((await api.list(people.viewer)).body.data.comments[0]).toMatchObject({ content: "corrected", edited: true });
  });

  it("nobody else may edit it: not another member, not an admin, not even the owner", async () => {
    const c = await createComment(taskId, people.member.id, "mine");
    for (const who of [people.member2, people.admin, people.owner]) {
      const res = await api.edit(who, c.id, { content: "hijacked" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).content).toBe("mine");
  });

  it("a viewer cannot edit, and an author demoted to VIEWER loses the right to edit", async () => {
    const own = await createComment(taskId, people.viewer.id, "from before");
    expect((await api.edit(people.viewer, own.id, { content: "x" })).status).toBe(403);

    const c = await createComment(taskId, people.member.id, "mine");
    await prisma.boardMember.update({ where: { boardId_userId: { boardId, userId: people.member.id } }, data: { role: "VIEWER" } });
    expect((await api.edit(people.member, c.id, { content: "x" })).status).toBe(403);
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).content).toBe("mine");
  });

  it("outsiders get the same 404 as for a comment that doesn't exist", async () => {
    const c = await createComment(taskId, people.member.id, "x");
    const outsider = await api.edit(people.outsider, c.id, { content: "y" });
    const unknown = await api.edit(people.outsider, "no-such-comment", { content: "y" });
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("COMMENT_NOT_FOUND");
    expect(outsider.body).toEqual(unknown.body);
  });

  it("validates the content (422, after authorization) and cannot reassign author or task", async () => {
    const c = await createComment(taskId, people.member.id, "x");
    for (const body of [{}, { content: "" }, { content: "y".repeat(5001) }]) expect((await api.edit(people.member, c.id, body)).status).toBe(422);
    expect((await api.edit(people.outsider, c.id, {})).status).toBe(404); // outsiders learn nothing from validation

    await api.edit(people.member, c.id, { content: "ok", userId: people.owner.id, taskId: otherTaskId }).expect(200);
    expect(await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ userId: people.member.id, taskId });
  });
});

describe("DELETE /api/comments/:commentId (author or moderator)", () => {
  it("lets authors delete their own comment", async () => {
    const c = await createComment(taskId, people.member.id, "oops");
    const res = await api.del(people.member, c.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
    expect(await count()).toBe(0);
  });

  it("lets OWNER and ADMIN delete other people's comments (moderation)", async () => {
    const a = await createComment(taskId, people.member.id, "a");
    const b = await createComment(taskId, people.member2.id, "b");
    expect((await api.del(people.admin, a.id)).status).toBe(200);
    expect((await api.del(people.owner, b.id)).status).toBe(200);
    expect(await count()).toBe(0);
  });

  it("does not let members or viewers delete other people's comments", async () => {
    const c = await createComment(taskId, people.owner.id, "from the owner");
    for (const who of [people.member, people.viewer]) {
      const res = await api.del(who, c.id);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect(await count()).toBe(1);
  });

  it("an author who was demoted to VIEWER may still remove their own comment", async () => {
    const c = await createComment(taskId, people.member.id, "mine");
    await prisma.boardMember.update({ where: { boardId_userId: { boardId, userId: people.member.id } }, data: { role: "VIEWER" } });
    expect((await api.del(people.member, c.id)).status).toBe(200);
  });

  it("outsiders get 404 and nothing is deleted; deleting twice is 404", async () => {
    const c = await createComment(taskId, people.member.id, "x");
    expect((await api.del(people.outsider, c.id)).status).toBe(404);
    expect(await count()).toBe(1);
    await api.del(people.member, c.id).expect(200);
    expect((await api.del(people.member, c.id)).status).toBe(404);
  });

  it("someone removed from the board can no longer touch their comments", async () => {
    const c = await createComment(taskId, people.member.id, "mine");
    await prisma.boardMember.delete({ where: { boardId_userId: { boardId, userId: people.member.id } } });
    expect((await api.edit(people.member, c.id, { content: "x" })).status).toBe(404);
    expect((await api.del(people.member, c.id)).status).toBe(404);
    expect((await api.list(people.member)).status).toBe(404);
  });
});

describe("database guarantees", () => {
  it("deleting a task deletes its comments (and only those)", async () => {
    await createComment(taskId, people.member.id, "goes away");
    await createComment(otherTaskId, people.member.id, "stays");
    await request(app).delete(`/api/tasks/${taskId}`).set("Cookie", people.owner.cookie).expect(200);
    expect((await prisma.comment.findMany()).map((c) => c.content)).toEqual(["stays"]);
  });

  it("deleting a board deletes its comments", async () => {
    await createComment(taskId, people.member.id, "x");
    await request(app).delete(`/api/boards/${boardId}`).set("Cookie", people.owner.cookie).expect(200);
    expect(await count()).toBe(0);
  });

  it("a user who has written comments cannot be deleted (history is not silently lost)", async () => {
    await createComment(taskId, people.member.id, "x");
    await expect(prisma.user.delete({ where: { id: people.member.id } })).rejects.toThrow();
    expect(await count()).toBe(1);
  });
});
