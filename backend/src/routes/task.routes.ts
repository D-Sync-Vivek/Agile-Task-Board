import { Router } from "express";
import type { Permission } from "../config/permissions";
import * as taskController from "../controllers/task.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireBoardPermission } from "../middleware/requireBoardPermission";
import { validateBody } from "../middleware/validate";
import { resolveTaskBoardId, taskNotFound } from "../services/task.service";
import { assignTaskSchema, createTaskSchema, moveTaskSchema, updateTaskSchema } from "../validators/task.validator";

/** Mounted at /api: task routes live under /boards/:boardId/tasks and /tasks/:taskId. */
export function createTaskRouter(): Router {
  const router = Router();

  // Addressed by task id: find the owning board; "no such task" and "not your board" look identical.
  const forTask = (permission: Permission) =>
    requireBoardPermission(permission, { getBoardId: (req) => resolveTaskBoardId(String(req.params.taskId)), notFound: taskNotFound });

  router.get("/boards/:boardId/tasks", requireAuth, requireBoardPermission("board:view"), taskController.list);
  router.post("/boards/:boardId/tasks", requireAuth, requireBoardPermission("task:create"), validateBody(createTaskSchema), taskController.create);

  router.get("/tasks/:taskId", requireAuth, forTask("board:view"), taskController.get);
  router.patch("/tasks/:taskId", requireAuth, forTask("task:update"), validateBody(updateTaskSchema), taskController.update);
  router.delete("/tasks/:taskId", requireAuth, forTask("task:delete"), taskController.remove);
  router.patch("/tasks/:taskId/move", requireAuth, forTask("task:move"), validateBody(moveTaskSchema), taskController.move);
  router.patch("/tasks/:taskId/assign", requireAuth, forTask("task:update"), validateBody(assignTaskSchema), taskController.assign);

  return router;
}
