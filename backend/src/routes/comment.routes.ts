import { Router } from "express";
import * as commentController from "../controllers/comment.controller";
import { requireAuth } from "../middleware/requireAuth";
import { forComment, forTask } from "../middleware/resourceGuards";
import { validateBody } from "../middleware/validate";
import { createCommentSchema, updateCommentSchema } from "../validators/comment.validator";

/**
 * Mounted at /api. The guards decide whether you may touch the board at all; "whose comment is it" (edit = author
 * only, delete = author or moderator) is decided in the service, which knows the comment's author.
 */
export function createCommentRouter(): Router {
  const router = Router();

  router.get("/tasks/:taskId/comments", requireAuth, forTask("board:view"), commentController.list);
  router.post("/tasks/:taskId/comments", requireAuth, forTask("comment:create"), validateBody(createCommentSchema), commentController.create);

  router.patch("/comments/:commentId", requireAuth, forComment("comment:create"), validateBody(updateCommentSchema), commentController.update);
  router.delete("/comments/:commentId", requireAuth, forComment("board:view"), commentController.remove);

  return router;
}
