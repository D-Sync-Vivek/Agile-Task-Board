import type { Request, RequestHandler } from "express";
import type { Permission } from "../config/permissions";
import { assertBoardPermission } from "../services/authorization.service";
import { AppError } from "../utils/AppError";

type BoardIdResolver = (req: Request) => string | undefined | Promise<string | undefined>;

const boardIdFromParams: BoardIdResolver = (req) => {
  const id = req.params.boardId;
  return typeof id === "string" ? id : undefined;
};

/**
 * Route guard. Must run AFTER requireAuth.
 *
 *   router.get("/:boardId", requireAuth, requireBoardPermission("board:view"), controller.get)
 *
 * On success it sets req.boardMembership ({ boardId, role }) for the handler.
 *
 * Routes keyed by something other than the board id (/tasks/:taskId, /columns/:columnId, ...) pass a
 * `getBoardId` resolver that looks up the owning board (return undefined if the resource doesn't exist) plus a
 * `notFound` factory. `notFound` is used BOTH when the resource doesn't exist and when the caller isn't a member of
 * its board, so the two cases are indistinguishable (otherwise IDs could be probed). Without it, the error is
 * BOARD_NOT_FOUND. A resolver may also throw its own error directly.
 */
export function requireBoardPermission(
  permission: Permission,
  options: { getBoardId?: BoardIdResolver; notFound?: () => AppError } = {}
): RequestHandler {
  const getBoardId = options.getBoardId ?? boardIdFromParams;
  const notFound = options.notFound ?? (() => new AppError(404, "BOARD_NOT_FOUND", "Board not found"));

  return async (req, _res, next) => {
    if (!req.user) {
      // requireAuth was not mounted before this guard; fail closed.
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const boardId = await getBoardId(req);
    if (!boardId) throw notFound();

    req.boardMembership = await assertBoardPermission(req.user.id, boardId, permission, { notFound });
    next();
  };
}
