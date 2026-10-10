import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/api/client";
import { createApi } from "@/lib/api/endpoints";

/** A fake client that records (method, path, body) so each endpoint function can be checked against the backend contract. */
function recorder() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const record = (method: string) =>
    vi.fn(async (path: string, ...rest: unknown[]) => {
      // post/patch: (path, body, options) ; get/delete: (path, options)
      const body = method === "POST" || method === "PATCH" ? rest[0] : undefined;
      calls.push({ method, path, body });
      return undefined as never;
    });
  const client = { get: record("GET"), post: record("POST"), patch: record("PATCH"), delete: record("DELETE") } as unknown as ApiClient;
  return { api: createApi(client), calls };
}

describe("endpoint functions match the backend routes", () => {
  const cases: [string, (api: ReturnType<typeof createApi>) => unknown, { method: string; path: string; body?: unknown }][] = [
    ["auth.register", (a) => a.auth.register({ name: "V", email: "v@x.io", password: "pw123456" }), { method: "POST", path: "/api/auth/register", body: { name: "V", email: "v@x.io", password: "pw123456" } }],
    ["auth.login", (a) => a.auth.login({ email: "v@x.io", password: "pw" }), { method: "POST", path: "/api/auth/login", body: { email: "v@x.io", password: "pw" } }],
    ["auth.logout", (a) => a.auth.logout(), { method: "POST", path: "/api/auth/logout" }],
    ["auth.me", (a) => a.auth.me(), { method: "GET", path: "/api/auth/me" }],
    ["boards.list", (a) => a.boards.list(), { method: "GET", path: "/api/boards" }],
    ["boards.create", (a) => a.boards.create({ name: "B" }), { method: "POST", path: "/api/boards", body: { name: "B" } }],
    ["boards.get", (a) => a.boards.get("b1"), { method: "GET", path: "/api/boards/b1" }],
    ["boards.update", (a) => a.boards.update("b1", { name: "N" }), { method: "PATCH", path: "/api/boards/b1", body: { name: "N" } }],
    ["boards.delete", (a) => a.boards.delete("b1"), { method: "DELETE", path: "/api/boards/b1" }],
    ["columns.create", (a) => a.columns.create("b1", { title: "Todo" }), { method: "POST", path: "/api/boards/b1/columns", body: { title: "Todo" } }],
    ["columns.rename", (a) => a.columns.rename("c1", { title: "Doing" }), { method: "PATCH", path: "/api/columns/c1", body: { title: "Doing" } }],
    ["columns.delete", (a) => a.columns.delete("c1"), { method: "DELETE", path: "/api/columns/c1" }],
    ["columns.reorder", (a) => a.columns.reorder("b1", ["c2", "c1"]), { method: "PATCH", path: "/api/boards/b1/columns/reorder", body: { columnIds: ["c2", "c1"] } }],
    ["tasks.list", (a) => a.tasks.list("b1"), { method: "GET", path: "/api/boards/b1/tasks" }],
    ["tasks.create", (a) => a.tasks.create("b1", { title: "T", columnId: "c1" }), { method: "POST", path: "/api/boards/b1/tasks", body: { title: "T", columnId: "c1" } }],
    ["tasks.get", (a) => a.tasks.get("t1"), { method: "GET", path: "/api/tasks/t1" }],
    ["tasks.update", (a) => a.tasks.update("t1", { title: "T2" }), { method: "PATCH", path: "/api/tasks/t1", body: { title: "T2" } }],
    ["tasks.delete", (a) => a.tasks.delete("t1"), { method: "DELETE", path: "/api/tasks/t1" }],
    ["tasks.move", (a) => a.tasks.move("t1", { columnId: "c2", position: 3 }), { method: "PATCH", path: "/api/tasks/t1/move", body: { columnId: "c2", position: 3 } }],
    ["tasks.assign", (a) => a.tasks.assign("t1", "u1"), { method: "PATCH", path: "/api/tasks/t1/assign", body: { assigneeId: "u1" } }],
    ["tasks.assign (unassign)", (a) => a.tasks.assign("t1", null), { method: "PATCH", path: "/api/tasks/t1/assign", body: { assigneeId: null } }],
    ["comments.list", (a) => a.comments.list("t1"), { method: "GET", path: "/api/tasks/t1/comments" }],
    ["comments.create", (a) => a.comments.create("t1", { content: "Hi" }), { method: "POST", path: "/api/tasks/t1/comments", body: { content: "Hi" } }],
    ["comments.update", (a) => a.comments.update("c1", { content: "Hi again" }), { method: "PATCH", path: "/api/comments/c1", body: { content: "Hi again" } }],
    ["comments.delete", (a) => a.comments.delete("c1"), { method: "DELETE", path: "/api/comments/c1" }],
    ["activity.forBoard", (a) => a.activity.forBoard("b1"), { method: "GET", path: "/api/boards/b1/activity" }],
    ["activity.forBoard (paged)", (a) => a.activity.forBoard("b1", { limit: 20, cursor: "abc" }), { method: "GET", path: "/api/boards/b1/activity?limit=20&cursor=abc" }],
    ["activity.forTask", (a) => a.activity.forTask("t1"), { method: "GET", path: "/api/tasks/t1/activity" }],
    ["activity.forTask (first page only)", (a) => a.activity.forTask("t1", { limit: 5 }), { method: "GET", path: "/api/tasks/t1/activity?limit=5" }],
  ];

  it.each(cases)("%s", async (_name, call, expected) => {
    const { api, calls } = recorder();
    await call(api);
    expect(calls).toEqual([expected]);
  });

  it("URL-encodes ids so they can't alter the path", async () => {
    const { api, calls } = recorder();
    await api.tasks.get("../boards/x?y=1#z");
    expect(calls[0].path).toBe("/api/tasks/..%2Fboards%2Fx%3Fy%3D1%23z");
  });
});
