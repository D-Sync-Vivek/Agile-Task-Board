import { Router } from "express";
import * as columnController from "../controllers/column.controller";
import { requireAuth } from "../middleware/requireAuth";
import { requireBoardPermission } from "../middleware/requireBoardPermission";
import { forColumn } from "../middleware/resourceGuards";
import { validateBody } from "../middleware/validate";
import { createColumnSchema, reorderColumnsSchema, updateColumnSchema } from "../validators/column.validator";

/** Mounted at /api: column routes live under both /boards/:boardId/... and /columns/:columnId. */
export function createColumnRouter(): Router {
  const router = Router();

  router.post("/boards/:boardId/columns", requireAuth, requireBoardPermission("column:create"), validateBody(createColumnSchema), columnController.create);
  router.patch("/boards/:boardId/columns/reorder", requireAuth, requireBoardPermission("column:update"), validateBody(reorderColumnsSchema), columnController.reorder);
  router.patch("/columns/:columnId", requireAuth, forColumn("column:update"), validateBody(updateColumnSchema), columnController.rename);
  router.delete("/columns/:columnId", requireAuth, forColumn("column:delete"), columnController.remove);

  return router;
}
