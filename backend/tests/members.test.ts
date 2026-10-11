import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { createBoardWithMembers, createColumn, createComment, createTask, createUser, resetDatabase } from "./helpers";

const app = createApp();

type Person = { id: string; cookie: string };
type Name = "owner" | "admin" | "admin2" | "member" | "viewer" | "outsider" | "newcomer";
const people = {} as Record<Name, Person>;
const emailOf = (n: string) => `${n.toLowerCase().replace(/\s+/g, ".")}@example.com`;
let boardId: string;

beforeEach(async () => {
  await resetDatabase();
  people.owner = await createUser("Olivia Owner");
  people.admin = await createUser("Adam Admin");
  people.admin2 = await createUser("Alice Admin");
  people.member = await createUser("Mia Member");
  people.viewer = await createUser("Victor Viewer");
  people.outsider = await createUser("Otto Outsider");
  people.newcomer = await createUser("Nina Newcomer");
  boardId = await createBoardWithMembers(people.owner.id, [
    { userId: people.admin.id, role: "ADMIN" as BoardRole },
    { userId: people.admin2.id, role: "ADMIN" as BoardRole },
    { userId: people.member.id, role: "MEMBER" as BoardRole },
    { userId: people.viewer.id, role: "VIEWER" as BoardRole },
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const as = (who: Person) => ({
  get: (url: string) => request(app).get(url).set("Cookie", who.cookie),
  post: (url: string, body: unknown) => request(app).post(url).set("Cookie", who.cookie).send(body as object),
  patch: (url: string, body: unknown) => request(app).patch(url).set("Cookie", who.cookie).send(body as object),
  del: (url: string) => request(app).delete(url).set("Cookie", who.cookie),
});
const base = () => `/api/boards/${boardId}/members`;
const memberIdOf = async (who: Person) => (await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId, userId: who.id } } })).id;
const roleOf = async (who: Person) => (await prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: who.id } } }))?.role ?? null;
const FULL_NAME: Record<Name, string> = { owner: "Olivia Owner", admin: "Adam Admin", admin2: "Alice Admin", member: "Mia Member", viewer: "Victor Viewer", outsider: "Otto Outsider", newcomer: "Nina Newcomer" };
const add = (actor: Person, who: Name, role?: string) => as(actor).post(base(), { email: emailOf(FULL_NAME[who]), ...(role && { role }) });
const setRole = async (actor: Person, target: Person, role: string) => as(actor).patch(`${base()}/${await memberIdOf(target)}`, { role });
const remove = async (actor: Person, target: Person) => as(actor).del(`${base()}/${await memberIdOf(target)}`);
const activity = async () => ((await as(people.owner).get(`/api/boards/${boardId}/activity`)).body.data.activities as { action: string; entityId: string; metadata: Record<string, unknown> }[]);

describe("GET members", () => {
  it("every role can list; includes user info but never password data", async () => {
    for (const who of [people.owner, people.admin, people.member, people.viewer]) {
      const res = await as(who).get(base());
      expect(res.status).toBe(200);
      expect(res.body.data.members).toHaveLength(5);
      expect(Object.keys(res.body.data.members[0].user).sort()).toEqual(["avatar", "email", "id", "name"]);
    }
  });
  it("401 without a session, 404 for outsiders", async () => {
    expect((await request(app).get(base())).status).toBe(401);
    expect((await as(people.outsider).get(base())).status).toBe(404);
  });
});

describe("POST members (add)", () => {
  it("OWNER can add ADMIN, MEMBER and VIEWER; the new member immediately gets access", async () => {
    expect((await as(people.newcomer).get(`/api/boards/${boardId}`)).status).toBe(404);
    const res = await add(people.owner, "newcomer", "ADMIN");
    expect(res.status).toBe(201);
    expect(res.body.data.member).toMatchObject({ role: "ADMIN", user: { name: "Nina Newcomer", email: "nina.newcomer@example.com" } });
    expect((await as(people.newcomer).get(`/api/boards/${boardId}`)).status).toBe(200);
  });

  it("defaults to MEMBER and matches the email case-insensitively", async () => {
    const res = await as(people.owner).post(base(), { email: "  NINA.Newcomer@Example.com " });
    expect(res.status).toBe(201);
    expect(res.body.data.member.role).toBe("MEMBER");
  });

  it("ADMIN can add MEMBER/VIEWER but cannot create another ADMIN (no escalation)", async () => {
    expect((await add(people.admin, "newcomer", "ADMIN")).status).toBe(403);
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(5);
    expect((await add(people.admin, "newcomer", "VIEWER")).status).toBe(201);
  });

  it("MEMBER and VIEWER cannot add anyone; outsiders see 404", async () => {
    expect((await add(people.member, "newcomer")).status).toBe(403);
    expect((await add(people.viewer, "newcomer")).status).toBe(403);
    expect((await add(people.outsider, "newcomer")).status).toBe(404);
  });

  it("OWNER can never be granted (422), and bad input is rejected", async () => {
    expect((await add(people.owner, "newcomer", "OWNER")).status).toBe(422);
    expect((await add(people.owner, "newcomer", "GOD")).status).toBe(422);
    expect((await as(people.owner).post(base(), { email: "not-an-email" })).status).toBe(422);
    expect((await as(people.owner).post(base(), {})).status).toBe(422);
  });

  it("unknown email -> 404 USER_NOT_FOUND; already a member -> 409 ALREADY_MEMBER", async () => {
    const unknown = await as(people.owner).post(base(), { email: "nobody@example.com" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("USER_NOT_FOUND");
    const dup = await add(people.owner, "member");
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_MEMBER");
  });

  it("two simultaneous adds of the same person: exactly one wins", async () => {
    const results = await Promise.all([add(people.owner, "newcomer"), add(people.admin, "newcomer")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.boardMember.count({ where: { boardId, userId: people.newcomer.id } })).toBe(1);
  });

  it("is logged as MEMBER_ADDED (and a rejected add is not)", async () => {
    await add(people.admin, "newcomer", "ADMIN"); // 403
    await add(people.owner, "newcomer", "VIEWER");
    const [entry, ...rest] = await activity();
    expect(entry).toMatchObject({ action: "MEMBER_ADDED", entityId: people.newcomer.id, metadata: { memberName: "Nina Newcomer", role: "VIEWER" } });
    expect(rest.filter((e) => e.action === "MEMBER_ADDED")).toHaveLength(0);
  });
});

describe("PATCH members/:memberId (change role)", () => {
  it("OWNER can promote and demote below OWNER", async () => {
    expect((await setRole(people.owner, people.member, "ADMIN")).body.data.member.role).toBe("ADMIN");
    expect((await setRole(people.owner, people.admin, "VIEWER")).body.data.member.role).toBe("VIEWER");
  });

  it("ADMIN can move MEMBER <-> VIEWER only", async () => {
    expect((await setRole(people.admin, people.member, "VIEWER")).status).toBe(200);
    expect((await setRole(people.admin, people.viewer, "MEMBER")).status).toBe(200);
    expect((await setRole(people.admin, people.member, "ADMIN")).status).toBe(403); // can't promote to own rank
    expect(await roleOf(people.member)).toBe("VIEWER");
  });

  it("ADMIN cannot touch another ADMIN or the OWNER", async () => {
    expect((await setRole(people.admin, people.admin2, "VIEWER")).status).toBe(403);
    expect((await setRole(people.admin, people.owner, "VIEWER")).status).toBe(403);
    expect(await roleOf(people.admin2)).toBe("ADMIN");
    expect(await roleOf(people.owner)).toBe("OWNER");
  });

  it("nobody can change their own role: a MEMBER cannot promote themselves, an ADMIN cannot make themselves OWNER", async () => {
    expect((await setRole(people.member, people.member, "ADMIN")).status).toBe(403);
    expect((await setRole(people.admin, people.admin, "OWNER")).status).toBe(422);
    expect((await setRole(people.admin, people.admin, "MEMBER")).status).toBe(403);
    expect((await setRole(people.owner, people.owner, "ADMIN")).status).toBe(403); // the owner row is untouchable
    expect(await roleOf(people.member)).toBe("MEMBER");
    expect(await roleOf(people.owner)).toBe("OWNER");
  });

  it("OWNER cannot be granted to anyone (422)", async () => {
    expect((await setRole(people.owner, people.member, "OWNER")).status).toBe(422);
  });

  it("MEMBER/VIEWER/outsider cannot change roles", async () => {
    expect((await setRole(people.member, people.viewer, "MEMBER")).status).toBe(403);
    expect((await setRole(people.viewer, people.member, "VIEWER")).status).toBe(403);
    expect((await setRole(people.outsider, people.member, "VIEWER")).status).toBe(404);
  });

  it("a member id from another board is 404 (can't be probed)", async () => {
    const otherBoard = await createBoardWithMembers(people.outsider.id, [{ userId: people.newcomer.id, role: "MEMBER" as BoardRole }]);
    const foreign = await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId: otherBoard, userId: people.newcomer.id } } });
    const res = await as(people.owner).patch(`${base()}/${foreign.id}`, { role: "VIEWER" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
    expect((await as(people.owner).patch(`${base()}/nope`, { role: "VIEWER" })).status).toBe(404);
  });

  it("takes effect on the very next request (a demoted admin loses admin powers at once)", async () => {
    expect((await add(people.admin2, "newcomer")).status).toBe(201);
    await setRole(people.owner, people.admin2, "MEMBER");
    expect((await as(people.admin2).post(`/api/boards/${boardId}/columns`, { title: "x" })).status).toBe(403);
  });

  it("logs MEMBER_ROLE_CHANGED with from/to; same role and rejected changes are not logged", async () => {
    await setRole(people.owner, people.member, "MEMBER"); // no-op
    await setRole(people.admin, people.member, "ADMIN"); // 403
    await setRole(people.owner, people.member, "ADMIN");
    const entries = (await activity()).filter((e) => e.action === "MEMBER_ROLE_CHANGED");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: people.member.id, metadata: { memberName: "Mia Member", from: "MEMBER", to: "ADMIN" } });
  });
});

describe("DELETE members/:memberId (remove)", () => {
  it("OWNER can remove an ADMIN; ADMIN can remove MEMBER and VIEWER", async () => {
    expect((await remove(people.owner, people.admin2)).status).toBe(200);
    expect((await remove(people.admin, people.member)).status).toBe(200);
    expect((await remove(people.admin, people.viewer)).status).toBe(200);
    expect(await prisma.boardMember.count({ where: { boardId } })).toBe(2);
  });

  it("ADMIN cannot remove an ADMIN, the OWNER or themselves; nobody can remove the OWNER", async () => {
    expect((await remove(people.admin, people.admin2)).status).toBe(403);
    expect((await remove(people.admin, people.owner)).status).toBe(403);
    expect((await remove(people.admin, people.admin)).status).toBe(403);
    expect((await remove(people.owner, people.owner)).status).toBe(403);
    expect(await roleOf(people.owner)).toBe("OWNER");
  });

  it("MEMBER/VIEWER/outsider cannot remove anyone", async () => {
    expect((await remove(people.member, people.viewer)).status).toBe(403);
    expect((await remove(people.viewer, people.member)).status).toBe(403);
    expect((await remove(people.outsider, people.member)).status).toBe(404);
  });

  it("revokes access immediately", async () => {
    expect((await as(people.member).get(`/api/boards/${boardId}`)).status).toBe(200);
    await remove(people.owner, people.member);
    expect((await as(people.member).get(`/api/boards/${boardId}`)).status).toBe(404);
  });

  it("unassigns their tasks, keeps their comments, and records how many tasks were unassigned", async () => {
    const col = await createColumn(boardId, "Todo", 0);
    const t1 = await createTask({ boardId, columnId: col.id, createdById: people.owner.id, title: "A", position: 0, assigneeId: people.member.id });
    await createTask({ boardId, columnId: col.id, createdById: people.owner.id, title: "B", position: 1, assigneeId: people.member.id });
    const keep = await createTask({ boardId, columnId: col.id, createdById: people.owner.id, title: "C", position: 2, assigneeId: people.viewer.id });
    await createComment(t1.id, people.member.id, "I was here");

    const res = await remove(people.owner, people.member);
    expect(res.body.data).toEqual({ unassignedTasks: 2 });
    expect(await prisma.task.count({ where: { boardId, assigneeId: people.member.id } })).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: keep.id } })).assigneeId).toBe(people.viewer.id);
    expect(await prisma.comment.count({ where: { taskId: t1.id, userId: people.member.id } })).toBe(1);
    expect((await activity())[0]).toMatchObject({ action: "MEMBER_REMOVED", entityId: people.member.id, metadata: { memberName: "Mia Member", unassignedTasks: 2 } });
  });

  it("removing twice: second is 404; a removed member can be added again", async () => {
    const id = await memberIdOf(people.member);
    expect((await as(people.owner).del(`${base()}/${id}`)).status).toBe(200);
    expect((await as(people.owner).del(`${base()}/${id}`)).status).toBe(404);
    expect((await add(people.owner, "member")).status).toBe(201);
  });

  it("a removed assignee can no longer be assigned (invariant: assignees are members)", async () => {
    const col = await createColumn(boardId, "Todo", 0);
    const task = await createTask({ boardId, columnId: col.id, createdById: people.owner.id, title: "A", position: 0 });
    await remove(people.owner, people.member);
    expect((await as(people.owner).patch(`/api/tasks/${task.id}/assign`, { assigneeId: people.member.id })).status).toBe(422);
  });
});
