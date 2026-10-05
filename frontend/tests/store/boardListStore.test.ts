import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardListStore } from "@/store/useBoardListStore";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, deferred } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const board = (id: string) => ({ id, name: id, description: null, ownerId: "u1", createdAt: "x", updatedAt: "x", myRole: "OWNER" as const, memberCount: 1, taskCount: 0 });
const store = () => useBoardListStore.getState();

beforeEach(() => {
  resetApiMock();
  store().reset();
  useAuthStore.setState({ status: "authenticated", user: null });
});

describe("board list store", () => {
  it("loads boards", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [board("a"), board("b")] });
    const pending = store().load();
    expect(store().status).toBe("loading");
    await pending;
    expect(store().status).toBe("ready");
    expect(store().boards.map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("reports failures, and a 401 ends the session", async () => {
    api.boards.list.mockRejectedValueOnce(apiError(401, "UNAUTHORIZED", "Authentication required"));
    await store().load();
    expect(store().status).toBe("error");
    expect(useAuthStore.getState().status).toBe("anonymous");
  });

  it("ignores an aborted or superseded load", async () => {
    const slow = deferred();
    api.boards.list.mockReturnValueOnce(slow.promise);
    const first = store().load();
    api.boards.list.mockResolvedValueOnce({ boards: [board("fresh")] });
    await store().load();
    slow.resolve({ boards: [board("stale")] });
    await first;
    expect(store().boards.map((b) => b.id)).toEqual(["fresh"]);
  });

  it("createBoard puts the new board first and throws on failure", async () => {
    api.boards.list.mockResolvedValueOnce({ boards: [board("old")] });
    await store().load();
    api.boards.create.mockResolvedValueOnce({ board: board("new") });
    await store().createBoard("new");
    expect(store().boards.map((b) => b.id)).toEqual(["new", "old"]);

    api.boards.create.mockRejectedValueOnce(apiError(422, "VALIDATION_ERROR"));
    await expect(store().createBoard("")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(store().boards).toHaveLength(2);
  });
});
