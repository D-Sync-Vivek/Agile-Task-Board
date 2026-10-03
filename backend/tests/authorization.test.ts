import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS, roleHasPermission } from "../src/config/permissions";
import type { Permission } from "../src/config/permissions";
import { prisma } from "../src/config/prisma";
import type { BoardRole } from "../src/generated/prisma/client";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler";
import { requireAuth } from "../src/middleware/requireAuth";
import { requireBoardPermission } from "../src/middleware/requireBoardPermission";
import { assertBoardPermission, getBoardMembership } from "../src/services/authorization.service";
import { AppError } from "../src/utils/AppError";
import { createBoardWithMembers, createUser, resetDatabase } from "./helpers";

/**
 * The expected policy, written out by hand from the product spec. It is deliberately NOT derived from
 * src/config/permissions.ts, so an accidental change to the matrix makes these tests fail.
 */
const EXPECTED: Record<BoardRole, readonly Permission[]> = {
  OWNER: [...PERMISSIONS], // everything
  ADMIN: [
    "board:view",
    "member:manage",
    "column:create",
    "column:update",
    "column:delete",
    "task:create",
    "task:update",
    "task:move",
    "task:delete",
    "comment:create",
  ],
  MEMBER: ["board:view", "task:create", "task:update", "task:move", "comment:create"],
  VIEWER: ["board:view"],
};
const ROLES = Object.keys(EXPECTED) as BoardRole[];

/** A throwaway app exposing one guarded probe route per permission, built from the real middleware. */
// ":" is route-parameter syntax in Express paths, so "board:view" can't be used verbatim in a URL pattern.
const probePath = (permission: Permission) => permission.replace(":", "_");

function buildProbeApp(thingToBoard: Record<string, string> = {}) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  for (const permission of PERMISSIONS) {
    app.get(`/boards/:boardId/probe/${probePath(permission)}`, requireAuth, requireBoardPermission(permission), (req, res) => {
      res.json({ success: true, data: { role: req.boardMembership?.role } });
    });
  }

  // Guard without requireAuth in front: must fail closed.
  app.get("/boards/:boardId/no-auth-guard", requireBoardPermission("board:view"), (_req, res) => {
    res.json({ success: true });
  });

  // Resource keyed by something other than the board id, resolved to its board.
  app.patch(
    "/things/:thingId",
    requireAuth,
    requireBoardPermission("task:update", {
      getBoardId: (req) => {
        const boardId = thingToBoard[String(req.params.thingId)];
        if (!boardId) throw new AppError(404, "THING_NOT_FOUND", "Thing not found");
        return boardId;
      },
    }),
    (_req, res) => {
      res.json({ success: true });
    }
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("permission matrix (pure)", () => {
  for (const role of ROLES) {
    it(`${role} has exactly the expected permissions`, () => {
      const granted = PERMISSIONS.filter((p) => roleHasPermission(role, p));
      expect(new Set(granted)).toEqual(new Set(EXPECTED[role]));
    });
  }

  it("roles are strictly nested: VIEWER ⊂ MEMBER ⊂ ADMIN ⊂ OWNER", () => {
    const order: BoardRole[] = ["VIEWER", "MEMBER", "ADMIN", "OWNER"];
    for (let i = 0; i < order.length - 1; i++) {
      for (const p of PERMISSIONS) {
        if (roleHasPermission(order[i], p)) expect(roleHasPermission(order[i + 1], p)).toBe(true);
      }
      expect(PERMISSIONS.filter((p) => roleHasPermission(order[i + 1], p)).length).toBeGreaterThan(
        PERMISSIONS.filter((p) => roleHasPermission(order[i], p)).length
      );
    }
  });
});

describe("board authorization over HTTP", () => {
  let app: ReturnType<typeof buildProbeApp>;
  let boardId: string;
  const people = {} as Record<BoardRole | "OUTSIDER", { id: string; cookie: string }>;

  beforeAll(() => {
    app = buildProbeApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    people.OWNER = await createUser("Olivia Owner");
    people.ADMIN = await createUser("Adam Admin");
    people.MEMBER = await createUser("Mia Member");
    people.VIEWER = await createUser("Victor Viewer");
    people.OUTSIDER = await createUser("Otto Outsider");
    boardId = await createBoardWithMembers(people.OWNER.id, [
      { userId: people.ADMIN.id, role: "ADMIN" },
      { userId: people.MEMBER.id, role: "MEMBER" },
      { userId: people.VIEWER.id, role: "VIEWER" },
    ]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const probe = (who: keyof typeof people, permission: Permission, id = () => boardId) =>
    request(app).get(`/boards/${id()}/probe/${probePath(permission)}`).set("Cookie", people[who].cookie);

  for (const role of ROLES) {
    it(`${role}: allowed exactly where the policy says, 403 elsewhere`, async () => {
      for (const permission of PERMISSIONS) {
        const res = await probe(role, permission);
        if (EXPECTED[role].includes(permission)) {
          expect(res.status, `${role} should be allowed ${permission}`).toBe(200);
          expect(res.body.data.role).toBe(role);
        } else {
          expect(res.status, `${role} should be denied ${permission}`).toBe(403);
          expect(res.body.error.code).toBe("FORBIDDEN");
        }
      }
    });
  }

  it("a non-member gets 404 for every permission (board existence is not revealed)", async () => {
    for (const permission of PERMISSIONS) {
      const res = await probe("OUTSIDER", permission);
      expect(res.status, permission).toBe(404);
      expect(res.body.error.code).toBe("BOARD_NOT_FOUND");
    }
  });

  it("a non-member cannot tell an existing board from one that doesn't exist", async () => {
    const existing = await probe("OUTSIDER", "board:view");
    const missing = await probe("OUTSIDER", "board:view", () => "no-such-board-id");
    expect(missing.status).toBe(existing.status);
    expect(missing.body).toEqual(existing.body);
  });

  it("returns 401 (not 403/404) when unauthenticated, and for a bad token", async () => {
    const anon = await request(app).get(`/boards/${boardId}/probe/board_view`);
    expect(anon.status).toBe(401);
    const bad = await request(app).get(`/boards/${boardId}/probe/board_view`).set("Cookie", "taskboard_token=junk");
    expect(bad.status).toBe(401);
  });

  it("fails closed (401) if the guard is mounted without requireAuth", async () => {
    const res = await request(app).get(`/boards/${boardId}/no-auth-guard`).set("Cookie", people.OWNER.cookie);
    expect(res.status).toBe(401);
  });

  it("role is per board: OWNER of A is only a VIEWER on B", async () => {
    const boardB = await createBoardWithMembers(people.OUTSIDER.id, [{ userId: people.OWNER.id, role: "VIEWER" }]);

    await probe("OWNER", "board:delete").expect(200); // board A
    const onB = await probe("OWNER", "board:delete", () => boardB);
    expect(onB.status).toBe(403);
    await probe("OWNER", "board:view", () => boardB).expect(200);
    // and the owner of B has no access at all to A
    await probe("OUTSIDER", "board:view").expect(404);
  });

  it("role changes and removals take effect on the very next request", async () => {
    await probe("MEMBER", "task:update").expect(200);

    await prisma.boardMember.update({
      where: { boardId_userId: { boardId, userId: people.MEMBER.id } },
      data: { role: "VIEWER" },
    });
    await probe("MEMBER", "task:update").expect(403);
    await probe("MEMBER", "board:view").expect(200);

    await prisma.boardMember.delete({ where: { boardId_userId: { boardId, userId: people.MEMBER.id } } });
    await probe("MEMBER", "board:view").expect(404);
  });

  it("supports a resolver for resources keyed by another id, and propagates its own 404", async () => {
    const appWithThings = buildProbeApp({ "thing-1": boardId });

    await request(appWithThings).patch("/things/thing-1").set("Cookie", people.MEMBER.cookie).expect(200);
    await request(appWithThings).patch("/things/thing-1").set("Cookie", people.VIEWER.cookie).expect(403);
    await request(appWithThings).patch("/things/thing-1").set("Cookie", people.OUTSIDER.cookie).expect(404);

    const missing = await request(appWithThings).patch("/things/nope").set("Cookie", people.OWNER.cookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("THING_NOT_FOUND");
  });

  it("with a notFound option, 'no such resource' and 'not your board' are indistinguishable", async () => {
    const app2 = express();
    app2.use(cookieParser());
    const guard = requireBoardPermission("task:update", {
      getBoardId: (req) => (req.params.thingId === "thing-1" ? boardId : undefined),
      notFound: () => new AppError(404, "THING_NOT_FOUND", "Thing not found"),
    });
    app2.patch("/things/:thingId", requireAuth, guard, (_req, res) => {
      res.json({ success: true });
    });
    app2.use(errorHandler);

    const notMine = await request(app2).patch("/things/thing-1").set("Cookie", people.OUTSIDER.cookie);
    const missing = await request(app2).patch("/things/nope").set("Cookie", people.OUTSIDER.cookie);
    expect(notMine.status).toBe(404);
    expect(notMine.body).toEqual(missing.body);
    expect(notMine.body.error.code).toBe("THING_NOT_FOUND");
    await request(app2).patch("/things/thing-1").set("Cookie", people.MEMBER.cookie).expect(200);
    await request(app2).patch("/things/thing-1").set("Cookie", people.VIEWER.cookie).expect(403);
  });

  describe("authorization service (usable outside HTTP, e.g. sockets)", () => {
    it("getBoardMembership returns the role or null", async () => {
      expect(await getBoardMembership(people.ADMIN.id, boardId)).toEqual({ boardId, role: "ADMIN" });
      expect(await getBoardMembership(people.OUTSIDER.id, boardId)).toBeNull();
      expect(await getBoardMembership(people.ADMIN.id, "missing")).toBeNull();
    });

    it("assertBoardPermission throws AppError with the right status", async () => {
      await expect(assertBoardPermission(people.VIEWER.id, boardId, "task:create")).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
      await expect(assertBoardPermission(people.OUTSIDER.id, boardId, "board:view")).rejects.toMatchObject({
        statusCode: 404,
        code: "BOARD_NOT_FOUND",
      });
      await expect(assertBoardPermission(people.OWNER.id, boardId, "board:delete")).resolves.toEqual({
        boardId,
        role: "OWNER",
      });
    });
  });
});
