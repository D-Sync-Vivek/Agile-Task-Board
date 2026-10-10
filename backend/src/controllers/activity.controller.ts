import type { Request, RequestHandler } from "express";
import { parseQuery } from "../middleware/validate";
import * as activityService from "../services/activity.service";
import { AppError } from "../utils/AppError";
import { activityQuerySchema } from "../validators/activity.validator";

// Runs behind requireAuth + requireBoardPermission("board:view"), which sets req.boardMembership.
function boardIdOf(req: Request): string {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership.boardId;
}

export const listForBoard: RequestHandler = async (req, res) => {
  const { limit, cursor } = parseQuery(activityQuerySchema, req.query);
  const result = await activityService.listActivity(boardIdOf(req), { limit, cursor });
  res.status(200).json({ success: true, data: result });
};

export const listForTask: RequestHandler = async (req, res) => {
  const { limit, cursor } = parseQuery(activityQuerySchema, req.query);
  const result = await activityService.listActivity(boardIdOf(req), { limit, cursor, taskId: String(req.params.taskId) });
  res.status(200).json({ success: true, data: result });
};
