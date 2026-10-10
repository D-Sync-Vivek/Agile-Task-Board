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

afterAll(async () => {
  await prisma.$disconnect();
});

const as = (who: Person) => ({
  post: (url: string, body: unknown) => request(app).post(url).set("Cookie", who.cookie).send(body as object),
  patch: (url: string, body: unknown) => request(app).patch(url).set("Cookie", who.cookie).send(body as object),
  get: (url: string) => request(app).get(url).set("Cookie", who.cookie),
  del: (url: string) => request(app).delete(url).set("Cookie", who.cookie),
});

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string };
  createdAt: string;
}

async function feed(who: Person = people.owner, query = ""): Promise<{ activities: Entry[]; nextCursor: string | null }> {
  const res = await as(who).get(`/api/boards/${boardId}/activity${query}`);
  expect(res.status).toBe(200);
  return res.body.data;
}
const actions = async () => (await feed()).activities.map((a) => a.action);

async function newTask(title = "Write docs", who = people.member) {
  const res = await as(who).post(`/api/boards/${boardId}/tasks`, { title, columnId: todo });
  expect(res.status).toBe(201);
  return res.body.data.task.id as string;
}

describe("activity is recorded by the services", () => {
  it("TASK_CREATED: who, what and where", async () => {
    const taskId = await newTask("Write docs");
    const [entry] = (await feed()).activities;
    expect(entry).toMatchObject({
      action: "TASK_CREATED",
      entityType: "TASK",
      entityId: taskId,
      actor: { id: people.member.id, name: "Mia Member" },
      metadata: { taskTitle: "Write docs", columnTitle: "Todo" },
    });
  });

  it("TASK_UPDATED lists exactly the fields that changed", async () => {
    const taskId = await newTask("Old title");
    const res = await as(people.member).patch(`/api/tasks/${taskId}`, { title: "New title", priority: "HIGH", dueDate: "2026-12-01", description: "details" });
    expect(res.status).toBe(200);

    const [entry] = (await feed()).activities;
    expect(entry.action).toBe("TASK_UPDATED");
    expect(entry.metadata).toEqual({
      taskTitle: "New title",
      changes: {
        title: { from: "Old title", to: "New title" },
        priority: { from: "MEDIUM", to: "HIGH" },
        dueDate: { from: null, to: "2026-12-01" },
        description: true, // the text itself is deliberately not stored
      },
    });
  });

  it("TASK_UPDATED is not recorded when nothing actually changed", async () => {
    const taskId = await newTask("Same");
    await as(people.member).patch(`/api/tasks/${taskId}`, { title: "Same", priority: "MEDIUM" });
    expect(await actions()).toEqual(["TASK_CREATED"]);
  });

  it("TASK_MOVED records source and target column across columns", async () => {
    const taskId = await newTask("Move me");
    const res = await as(people.member).patch(`/api/tasks/${taskId}/move`, { columnId: doing, position: 0 });
    expect(res.status).toBe(200);

    const [entry] = (await feed()).activities;
    expect(entry.action).toBe("TASK_MOVED");
    expect(entry.metadata).toEqual({ taskTitle: "Move me", fromColumn: { id: todo, title: "Todo" }, toColumn: { id: doing, title: "Doing" } });
  });

  it("reordering inside one column is not recorded", async () => {
    await newTask("A");
    const b = await newTask("B");
    await as(people.member).patch(`/api/tasks/${b}/move`, { columnId: todo, position: 0 });
    expect(await actions()).toEqual(["TASK_CREATED", "TASK_CREATED"]);
  });

  it("TASK_ASSIGNED records previous and new assignee, including unassigning", async () => {
    const taskId = await newTask("Assign me");
    await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: people.admin.id });
    await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: null });

    const [unassigned, assigned] = (await feed()).activities;
    expect(assigned.metadata).toEqual({ taskTitle: "Assign me", from: null, to: { id: people.admin.id, name: "Adam Admin" } });
    expect(unassigned.metadata).toEqual({ taskTitle: "Assign me", from: { id: people.admin.id, name: "Adam Admin" }, to: null });
  });

  it("re-assigning the same person is not recorded", async () => {
    const taskId = await newTask("Assign me");
    await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: people.admin.id });
    await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: people.admin.id });
    expect((await actions()).filter((a) => a === "TASK_ASSIGNED")).toHaveLength(1);
  });

  it("TASK_DELETED keeps a snapshot, and the history outlives the task", async () => {
    const taskId = await newTask("Short lived");
    const res = await as(people.admin).del(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);

    const [entry] = (await feed()).activities;
    expect(entry).toMatchObject({ action: "TASK_DELETED", entityId: taskId, metadata: { taskTitle: "Short lived", columnTitle: "Todo" } });
    expect(await prisma.task.count({ where: { id: taskId } })).toBe(0);
  });

  it("COLUMN_CREATED / COLUMN_RENAMED / COLUMN_DELETED (with the number of tasks that went with it)", async () => {
    const created = await as(people.admin).post(`/api/boards/${boardId}/columns`, { title: "Review" });
    const columnId = created.body.data.column.id as string;
    await as(people.admin).patch(`/api/columns/${columnId}`, { title: "In Review" });
    await as(people.admin).patch(`/api/columns/${columnId}`, { title: "In Review" }); // no-op
    await createTask({ boardId, columnId, createdById: people.owner.id, title: "t1", position: 0 });
    await createTask({ boardId, columnId, createdById: people.owner.id, title: "t2", position: 1 });
    await as(people.admin).del(`/api/columns/${columnId}`);

    const entries = (await feed()).activities;
    expect(entries.map((e) => e.action)).toEqual(["COLUMN_DELETED", "COLUMN_RENAMED", "COLUMN_CREATED"]);
    expect(entries[2].metadata).toEqual({ columnTitle: "Review" });
    expect(entries[1].metadata).toEqual({ from: "Review", to: "In Review" });
    expect(entries[0].metadata).toEqual({ columnTitle: "In Review", taskCount: 2 });
    expect(entries.every((e) => e.entityType === "COLUMN" && e.entityId === columnId)).toBe(true);
  });

  it("COMMENT_ADDED points at the task and does not copy the comment text", async () => {
    const taskId = await newTask("Discuss");
    const res = await as(people.member).post(`/api/tasks/${taskId}/comments`, { content: "secret-ish text" });
    expect(res.status).toBe(201);

    const [entry] = (await feed()).activities;
    expect(entry).toMatchObject({ action: "COMMENT_ADDED", entityType: "COMMENT", entityId: res.body.data.comment.id, metadata: { taskId, taskTitle: "Discuss" } });
    expect(JSON.stringify(entry)).not.toContain("secret-ish");
  });

  it("editing/deleting a comment and reordering columns create no entries", async () => {
    const taskId = await newTask("Quiet");
    const c = await as(people.member).post(`/api/tasks/${taskId}/comments`, { content: "x" });
    const id = c.body.data.comment.id as string;
    await as(people.member).patch(`/api/comments/${id}`, { content: "y" });
    await as(people.member).del(`/api/comments/${id}`);
    await as(people.admin).patch(`/api/boards/${boardId}/columns/reorder`, { columnIds: [doing, todo] });
    expect(await actions()).toEqual(["COMMENT_ADDED", "TASK_CREATED"]);
  });
});

describe("failed mutations leave no history", () => {
  it("rejected assignment (non-member), forbidden and invalid requests record nothing", async () => {
    const taskId = await newTask("Guarded");
    const before = await prisma.activityLog.count();

    expect((await as(people.member).patch(`/api/tasks/${taskId}/assign`, { assigneeId: people.outsider.id })).status).toBe(422);
    expect((await as(people.viewer).patch(`/api/tasks/${taskId}`, { title: "hax" })).status).toBe(403);
    expect((await as(people.viewer).del(`/api/tasks/${taskId}`)).status).toBe(403);
    expect((await as(people.member).patch(`/api/tasks/${taskId}/move`, { columnId: "00000000-0000-4000-8000-000000000000", position: 0 })).status).toBe(404);
    expect((await as(people.member).patch(`/api/tasks/${taskId}`, { title: "" })).status).toBe(422);
    expect((await as(people.member).post(`/api/tasks/${taskId}/comments`, { content: "   " })).status).toBe(422);
    expect((await as(people.member).post(`/api/boards/${boardId}/columns`, { title: "nope" })).status).toBe(403);

    expect(await prisma.activityLog.count()).toBe(before);
  });
});

describe("GET /api/boards/:boardId/activity", () => {
  it("returns newest first with a public actor (no email / password data)", async () => {
    const a = await newTask("First");
    await as(people.member).patch(`/api/tasks/${a}/move`, { columnId: doing, position: 0 });
    const { activities } = await feed();
    expect(activities.map((e) => e.action)).toEqual(["TASK_MOVED", "TASK_CREATED"]);
    expect(Object.keys(activities[0].actor).sort()).toEqual(["avatar", "id", "name"]);
  });

  it("is readable by every role, including VIEWER", async () => {
    await newTask();
    for (const who of [people.owner, people.admin, people.member, people.viewer]) {
      expect((await feed(who)).activities).toHaveLength(1);
    }
  });

  it("requires authentication (401) and hides the board from outsiders (404)", async () => {
    await newTask();
    expect((await request(app).get(`/api/boards/${boardId}/activity`)).status).toBe(401);
    expect((await as(people.outsider).get(`/api/boards/${boardId}/activity`)).status).toBe(404);
  });

  it("is read-only: there is no write endpoint", async () => {
    const res = await as(people.owner).post(`/api/boards/${boardId}/activity`, { action: "TASK_CREATED" });
    expect(res.status).toBe(404);
  });

  it("only shows the requested board's activity", async () => {
    await newTask();
    const otherBoard = await createBoardWithMembers(people.owner.id);
    const col = await createColumn(otherBoard, "Todo", 0);
    await as(people.owner).post(`/api/boards/${otherBoard}/tasks`, { title: "Elsewhere", columnId: col.id });
    expect((await feed()).activities.map((e) => e.metadata.taskTitle)).toEqual(["Write docs"]);
  });

  it("paginates with a cursor without skipping or repeating entries", async () => {
    for (let i = 0; i < 5; i++) await newTask(`T${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { activities: Entry[]; nextCursor: string | null } = await feed(people.owner, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.activities.map((e) => String(e.metadata.taskTitle)));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(["T4", "T3", "T2", "T1", "T0"]);
  });

  it("validates limit and cursor (422)", async () => {
    for (const q of ["?limit=0", "?limit=101", "?limit=abc", "?cursor=not-a-uuid"]) {
      const res = await as(people.owner).get(`/api/boards/${boardId}/activity${q}`);
      expect(res.status, q).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("is removed with the board (ON DELETE CASCADE)", async () => {
    await newTask();
    expect((await as(people.owner).del(`/api/boards/${boardId}`)).status).toBe(200);
    expect(await prisma.activityLog.count({ where: { boardId } })).toBe(0);
  });
});

describe("GET /api/tasks/:taskId/activity", () => {
  it("shows that task's events and the comments on it, and nothing about other tasks", async () => {
    const a = await newTask("Task A");
    const b = await newTask("Task B");
    await as(people.member).patch(`/api/tasks/${a}/move`, { columnId: doing, position: 0 });
    await as(people.member).post(`/api/tasks/${a}/comments`, { content: "on A" });
    await as(people.member).post(`/api/tasks/${b}/comments`, { content: "on B" });

    const res = await as(people.viewer).get(`/api/tasks/${a}/activity`);
    expect(res.status).toBe(200);
    expect((res.body.data.activities as Entry[]).map((e) => e.action)).toEqual(["COMMENT_ADDED", "TASK_MOVED", "TASK_CREATED"]);
    expect((res.body.data.activities as Entry[]).every((e) => e.metadata.taskTitle === "Task A")).toBe(true);
  });

  it("hides the task from outsiders (404) and requires authentication (401)", async () => {
    const a = await newTask();
    expect((await as(people.outsider).get(`/api/tasks/${a}/activity`)).status).toBe(404);
    expect((await request(app).get(`/api/tasks/${a}/activity`)).status).toBe(401);
  });
});
