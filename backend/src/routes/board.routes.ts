import { Router } from "express";
import * as boardController from "../controllers/board.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireBoardPermission } from "../middleware/requireBoardPermission";
import { validateBody } from "../middleware/validate";
import { createBoardSchema, updateBoardSchema } from "../validators/board.validator";

export function createBoardRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", boardController.list);
  router.post("/", validateBody(createBoardSchema), boardController.create);

  // Authorization runs before body validation so outsiders always see 404, whatever they send.
  router.get("/:boardId", requireBoardPermission("board:view"), boardController.get);
  router.patch("/:boardId", requireBoardPermission("board:update"), validateBody(updateBoardSchema), boardController.update);
  router.delete("/:boardId", requireBoardPermission("board:delete"), boardController.remove);

  return router;
}
