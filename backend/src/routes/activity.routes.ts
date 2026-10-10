import { Router } from "express";
import * as activityController from "../controllers/activity.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireBoardPermission } from "../middleware/requireBoardPermission";
import { forTask } from "../middleware/resourceGuards";

/** Mounted at /api. Activity is read-only over HTTP: entries are only ever written by the services that make the change. */
export function createActivityRouter(): Router {
  const router = Router();

  router.get("/boards/:boardId/activity", requireAuth, requireBoardPermission("board:view"), activityController.listForBoard);
  router.get("/tasks/:taskId/activity", requireAuth, forTask("board:view"), activityController.listForTask);

  return router;
}
