import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMember, changeMemberRole, removeMember } from "@/store/memberActions";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import type { BoardMemberDto } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, flush, makeBoard, makeColumn, makeTask } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const NOW = "2026-10-04T10:00:00.000Z";
const member = (id: string, userId: string, name: string, role: BoardMemberDto["role"]): BoardMemberDto => ({ id, userId, role, createdAt: NOW, user: { id: userId, name, email: `${userId}@example.com`, avatar: null } });
const roles = () => useBoardStore.getState().board!.members.map((m) => `${m.user.name}:${m.role}`);

beforeEach(async () => {
  resetApiMock();
  useBoardStore.getState().reset();
  useAuthStore.setState({ status: "authenticated", user: { id: "u1", name: "Me", email: "u1@example.com", avatar: null, createdAt: NOW } });
  const t = makeTask("t1", "c1", "Assigned to Mia", 0);
  api.boards.get.mockResolvedValue({
    board: makeBoard({ members: [member("m1", "u1", "Me", "OWNER"), member("m2", "u2", "Mia", "MEMBER")], columns: [makeColumn("c1", "Todo", 0)], tasks: [{ ...t, assigneeId: "u2" }, makeTask("t2", "c1", "Other", 1)] }),
  });
  await useBoardStore.getState().loadBoard("b1");
});

describe("addMember", () => {
  it("adds the server's member to the board once the server accepted it", async () => {
    api.members.add.mockResolvedValue({ member: member("m3", "u3", "Rahul", "VIEWER") });
    await addMember("b1", "rahul@example.com", "VIEWER");
    expect(api.members.add).toHaveBeenCalledWith("b1", { email: "rahul@example.com", role: "VIEWER" });
    expect(roles()).toEqual(["Me:OWNER", "Mia:MEMBER", "Rahul:VIEWER"]);
  });

  it("does not change anything and rethrows when refused; form answers don't trigger a board reload", async () => {
    api.members.add.mockRejectedValue(apiError(404, "USER_NOT_FOUND", "No user"));
    await expect(addMember("b1", "x@example.com", "MEMBER")).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    api.members.add.mockRejectedValue(apiError(409, "ALREADY_MEMBER", "Already"));
    await expect(addMember("b1", "mia@example.com", "MEMBER")).rejects.toMatchObject({ code: "ALREADY_MEMBER" });
    await flush();
    expect(roles()).toEqual(["Me:OWNER", "Mia:MEMBER"]);
    expect(api.boards.get).toHaveBeenCalledTimes(1);
  });

  it("a 403 (our role changed) rethrows and quietly re-reads the board", async () => {
    api.members.add.mockRejectedValue(apiError(403, "FORBIDDEN", "No"));
    await expect(addMember("b1", "x@example.com", "MEMBER")).rejects.toMatchObject({ status: 403 });
    await flush();
    expect(api.boards.get).toHaveBeenCalledTimes(2);
  });

  it("401 marks the session anonymous", async () => {
    api.members.add.mockRejectedValue(apiError(401, "UNAUTHORIZED"));
    await expect(addMember("b1", "x@example.com", "MEMBER")).rejects.toBeTruthy();
    expect(useAuthStore.getState().status).toBe("anonymous");
  });
});

describe("changeMemberRole", () => {
  it("replaces the member with the server's version", async () => {
    api.members.updateRole.mockResolvedValue({ member: member("m2", "u2", "Mia", "ADMIN") });
    await changeMemberRole("b1", "m2", "ADMIN");
    expect(api.members.updateRole).toHaveBeenCalledWith("b1", "m2", "ADMIN");
    expect(roles()).toEqual(["Me:OWNER", "Mia:ADMIN"]);
  });

  it("keeps the old role when refused", async () => {
    api.members.updateRole.mockRejectedValue(apiError(403, "FORBIDDEN", "No"));
    await expect(changeMemberRole("b1", "m2", "ADMIN")).rejects.toMatchObject({ status: 403 });
    expect(roles()).toEqual(["Me:OWNER", "Mia:MEMBER"]);
  });
});

describe("removeMember", () => {
  it("removes the member and unassigns their tasks locally, like the server did", async () => {
    api.members.remove.mockResolvedValue({ unassignedTasks: 1 });
    await removeMember("b1", "m2");
    expect(roles()).toEqual(["Me:OWNER"]);
    expect(useBoardStore.getState().tasks.map((t) => t.assigneeId)).toEqual([null, null]);
  });

  it("keeps the member when the server refuses", async () => {
    api.members.remove.mockRejectedValue(apiError(500, "INTERNAL_ERROR", "Boom"));
    await expect(removeMember("b1", "m2")).rejects.toMatchObject({ status: 500 });
    expect(roles()).toEqual(["Me:OWNER", "Mia:MEMBER"]);
    expect(useBoardStore.getState().tasks[0].assigneeId).toBe("u2");
  });

  it("treats 'already removed' (404) as success", async () => {
    api.members.remove.mockRejectedValue(apiError(404, "MEMBER_NOT_FOUND", "Gone"));
    api.boards.get.mockResolvedValue({ board: makeBoard({ members: [member("m1", "u1", "Me", "OWNER")] }) }); // what the re-read will find
    await expect(removeMember("b1", "m2")).resolves.toBeUndefined();
    expect(roles()).toEqual(["Me:OWNER"]);
    await flush();
    expect(api.boards.get).toHaveBeenCalledTimes(2); // re-read to be sure
    expect(roles()).toEqual(["Me:OWNER"]);
  });
});
