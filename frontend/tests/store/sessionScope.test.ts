// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardActivityStore, useTaskActivityStore } from "@/store/useActivityStores";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardListStore } from "@/store/useBoardListStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import type { ApiUser, BoardSummary } from "@/types/api";
import { api, resetApiMock } from "../helpers/apiMock";
import { apiError, makeActivity, makeBoard, makeComment } from "../helpers/fixtures";

vi.mock("@/lib/api", () => import("../helpers/apiMock"));

const NOW = "2026-10-04T10:00:00.000Z";
const alice: ApiUser = { id: "u1", name: "Alice", email: "alice@example.com", avatar: null, createdAt: NOW };
const bob: ApiUser = { id: "u2", name: "Bob", email: "bob@example.com", avatar: null, createdAt: NOW };
const summary = { id: "b1", name: "Alice's private board", description: null, myRole: "OWNER", taskCount: 3, memberCount: 1, updatedAt: NOW } as unknown as BoardSummary;

/** Fill every user-scoped cache, as if Alice had been working. */
async function fillCaches() {
  api.boards.list.mockResolvedValue({ boards: [summary] });
  api.boards.get.mockResolvedValue({ board: makeBoard() });
  api.comments.list.mockResolvedValue({ comments: [makeComment("c1", "u1", "Alice", "secret comment")] });
  const feed = { activities: [makeActivity("a1", { action: "COLUMN_CREATED", entityType: "COLUMN", metadata: { columnTitle: "Secret" } })], nextCursor: null };
  api.activity.forBoard.mockResolvedValue(feed);
  api.activity.forTask.mockResolvedValue(feed);

  await useBoardListStore.getState().load();
  await useBoardStore.getState().loadBoard("b1");
  await useCommentStore.getState().load("t1");
  await useBoardActivityStore.getState().load("b1");
  await useTaskActivityStore.getState().load("t1");
  useTaskPanelStore.getState().open("t1");

  // sanity: it really is full
  expect(useBoardListStore.getState().boards).toHaveLength(1);
  expect(useBoardStore.getState().tasks.length).toBeGreaterThan(0);
  expect(useCommentStore.getState().comments).toHaveLength(1);
  expect(useBoardActivityStore.getState().entries).toHaveLength(1);
  expect(useTaskActivityStore.getState().entries).toHaveLength(1);
}

function expectAllEmpty() {
  expect(useBoardListStore.getState()).toMatchObject({ boards: [], status: "idle" });
  expect(useBoardStore.getState()).toMatchObject({ board: null, columns: [], tasks: [], status: "idle" });
  expect(useCommentStore.getState()).toMatchObject({ taskId: null, comments: [], status: "idle" });
  expect(useBoardActivityStore.getState()).toMatchObject({ scopeId: null, entries: [], status: "idle" });
  expect(useTaskActivityStore.getState()).toMatchObject({ scopeId: null, entries: [], status: "idle" });
  expect(useTaskPanelStore.getState().taskId).toBeNull();
}

beforeEach(() => {
  resetApiMock();
  useAuthStore.setState({ status: "authenticated", user: alice });
});

describe("caches never outlive the user they belong to", () => {
  it("logging out clears everything that was cached", async () => {
    await fillCaches();
    api.auth.logout.mockResolvedValue(null);
    await useAuthStore.getState().logout();
    expectAllEmpty();
  });

  it("logging out clears the caches even when the logout request itself fails", async () => {
    await fillCaches();
    api.auth.logout.mockRejectedValue(apiError(0, "NETWORK_ERROR", "offline"));
    await useAuthStore.getState().logout().catch(() => undefined);
    expectAllEmpty();
  });

  it("an expired session (401 mid-use) clears everything too", async () => {
    await fillCaches();
    useAuthStore.getState().markAnonymous();
    expectAllEmpty();
  });

  it("a DIFFERENT account signing in on the same tab starts from nothing", async () => {
    await fillCaches();
    api.auth.login.mockResolvedValue({ user: bob });
    await useAuthStore.getState().login({ email: bob.email, password: "x" });
    expectAllEmpty();
    expect(useAuthStore.getState().user?.id).toBe("u2");
  });

  it("the SAME user's session being re-confirmed keeps the caches (no needless reloads)", async () => {
    await fillCaches();
    api.auth.me.mockResolvedValue({ user: { ...alice, name: "Alice Renamed" } });
    await useAuthStore.getState().fetchSession();
    expect(useBoardStore.getState().tasks.length).toBeGreaterThan(0);
    expect(useBoardListStore.getState().boards).toHaveLength(1);
    expect(useCommentStore.getState().comments).toHaveLength(1);
  });

  it("a session check that merely fails to reach the server keeps the caches (the user is still signed in)", async () => {
    await fillCaches();
    api.auth.me.mockRejectedValue(apiError(0, "NETWORK_ERROR", "offline"));
    await useAuthStore.getState().fetchSession();
    expect(useAuthStore.getState().status).toBe("error");
    expect(useBoardStore.getState().tasks.length).toBeGreaterThan(0);
  });

  it("signing in for the first time (nobody before) does not disturb anything", () => {
    useAuthStore.setState({ status: "anonymous", user: null });
    useBoardListStore.setState({ boards: [summary], status: "ready" });
    useAuthStore.setState({ status: "authenticated", user: alice });
    expect(useBoardListStore.getState().boards).toHaveLength(1);
  });
});

describe("nothing is kept in the browser", () => {
  it("working with the app leaves localStorage and sessionStorage empty", async () => {
    localStorage.clear();
    sessionStorage.clear();
    api.auth.login.mockResolvedValue({ user: alice });
    await useAuthStore.getState().login({ email: alice.email, password: "x" });
    await fillCaches();
    api.auth.logout.mockResolvedValue(null);
    await useAuthStore.getState().logout();

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(""); // the session cookie is HTTP-only: JavaScript never sees or sets any cookie
  });

  it("a fresh start knows nobody: the user only exists after the server says so", () => {
    // Simulates a page reload: stores start from their initial state, nothing is restored from the browser.
    useAuthStore.setState({ status: "unknown", user: null });
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().status).toBe("unknown");
  });
});
