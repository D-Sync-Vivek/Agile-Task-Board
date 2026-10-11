/**
 * Opt-in: member management against the REAL backend + PostgreSQL. Two real accounts (one cookie jar, switching
 * sessions) prove that roles and removals actually change what each user may do, not just what the UI shows.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { installCookieJar } from "./cookieJar";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
process.env.NEXT_PUBLIC_API_URL = API_URL;

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const { api } = await import("@/lib/api");
const { describeActivity } = await import("@/lib/activity");
const { useBoardStore } = await import("@/store/useBoardStore");
const { addMember, changeMemberRole, removeMember } = await import("@/store/memberActions");

const OWNER = { name: "Olivia Owner", email: `owner-${stamp}@example.com`, password: "password123" };
const GUEST = { name: "Gus Guest", email: `guest-${stamp}@example.com`, password: "password123" };

describe("members against the real backend", () => {
  let boardId: string;
  let columnId: string;
  let taskId: string;

  beforeAll(async () => {
    const reachable = await fetch(`${API_URL}/api/auth/me`).then(() => true, () => false);
    if (!reachable) throw new Error(`Backend not reachable at ${API_URL}. Start it first (cd backend && AUTH_RATE_LIMIT_MAX=1000 npm run dev).`);
    installCookieJar();
    await api.auth.register(GUEST); // exists first, so the owner can add them by email
    await api.auth.logout();
    await api.auth.register(OWNER);
    boardId = (await api.boards.create({ name: "Members integration" })).board.id;
    columnId = (await api.columns.create(boardId, { title: "Todo" })).column.id;
    taskId = (await api.tasks.create(boardId, { title: "Shared work", columnId })).task.id;
    await useBoardStore.getState().loadBoard(boardId);
  });

  const members = () => useBoardStore.getState().board!.members.map((m) => `${m.user.name}:${m.role}`);
  const guestId = () => useBoardStore.getState().board!.members.find((m) => m.user.email === GUEST.email)!.id;

  it("refuses an unknown email and a role of OWNER", async () => {
    await expect(addMember(boardId, `nobody-${stamp}@example.com`, "MEMBER")).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    await expect(addMember(boardId, GUEST.email, "OWNER" as never)).rejects.toMatchObject({ status: 422 });
    expect(members()).toEqual(["Olivia Owner:OWNER"]);
  });

  it("adds the guest by email (as VIEWER) and rejects a duplicate", async () => {
    await addMember(boardId, GUEST.email.toUpperCase(), "VIEWER");
    expect(members()).toEqual(["Olivia Owner:OWNER", "Gus Guest:VIEWER"]);
    await expect(addMember(boardId, GUEST.email, "MEMBER")).rejects.toMatchObject({ status: 409, code: "ALREADY_MEMBER" });
  });

  it("the role really limits the guest: a VIEWER can read but not write, nor manage members", async () => {
    await api.auth.logout();
    await api.auth.login(GUEST);
    expect((await api.boards.get(boardId)).board.myRole).toBe("VIEWER");
    await expect(api.tasks.create(boardId, { title: "nope", columnId })).rejects.toMatchObject({ status: 403 });
    await expect(addMember(boardId, OWNER.email, "VIEWER")).rejects.toMatchObject({ status: 403 });
    await expect(api.members.updateRole(boardId, guestId(), "ADMIN")).rejects.toMatchObject({ status: 403 }); // cannot promote self
    await api.auth.logout();
    await api.auth.login(OWNER);
    await useBoardStore.getState().loadBoard(boardId);
  });

  it("promoting to MEMBER lets them write; the owner can then assign them a task", async () => {
    await changeMemberRole(boardId, guestId(), "MEMBER");
    expect(members()).toContain("Gus Guest:MEMBER");
    const guestUserId = useBoardStore.getState().board!.members.find((m) => m.user.email === GUEST.email)!.userId;
    await api.tasks.assign(taskId, guestUserId);
    expect((await api.tasks.get(taskId)).task.assigneeId).toBe(guestUserId);
  });

  it("removing the guest revokes access, unassigns their task and keeps the log readable", async () => {
    await removeMember(boardId, guestId());
    expect(members()).toEqual(["Olivia Owner:OWNER"]);
    expect((await api.tasks.get(taskId)).task.assigneeId).toBeNull();
    expect(useBoardStore.getState().tasks.find((t) => t.id === taskId)?.assigneeId).toBeNull();

    const { activities } = await api.activity.forBoard(boardId);
    const sentences = activities.map(describeActivity);
    expect(sentences.slice(0, 2)).toEqual(["removed Gus Guest from the board (1 task unassigned)", "assigned “Shared work” to Gus Guest"]);
    expect(sentences).toContain("changed Gus Guest from Viewer to Member");
    expect(sentences).toContain("added Gus Guest as Viewer");

    await api.auth.logout();
    await api.auth.login(GUEST);
    await expect(api.boards.get(boardId)).rejects.toMatchObject({ status: 404 });
    await api.auth.logout();
  });
});
