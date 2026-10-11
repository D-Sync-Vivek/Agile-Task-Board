import { Router } from "express";
import * as memberController from "../controllers/member.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireBoardPermission } from "../middleware/requireBoardPermission";
import { validateBody } from "../middleware/validate";
import { addMemberSchema, updateMemberSchema } from "../validators/member.validator";

/**
 * Mounted at /api. Viewing the member list needs board:view; changing it needs member:manage. Which roles a given
 * manager may grant or touch is decided in the service (it depends on the target), under the board lock.
 */
export function createMemberRouter(): Router {
  const router = Router();

  router.get("/boards/:boardId/members", requireAuth, requireBoardPermission("board:view"), memberController.list);
  router.post("/boards/:boardId/members", requireAuth, requireBoardPermission("member:manage"), validateBody(addMemberSchema), memberController.add);
  router.patch("/boards/:boardId/members/:memberId", requireAuth, requireBoardPermission("member:manage"), validateBody(updateMemberSchema), memberController.updateRole);
  router.delete("/boards/:boardId/members/:memberId", requireAuth, requireBoardPermission("member:manage"), memberController.remove);

  return router;
}
