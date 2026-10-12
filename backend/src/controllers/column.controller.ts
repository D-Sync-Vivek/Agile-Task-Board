import type { Request, RequestHandler } from "express";
import * as columnService from "../services/column.service";
import { broadcast, flushActivity } from "../sockets/realtime";
import { AppError } from "../utils/AppError";
import type { CreateColumnInput, ReorderColumnsInput, UpdateColumnInput } from "../validators/column.validator";

// All handlers run behind requireAuth + requireBoardPermission, which set req.boardMembership.
function userIdOf(req: Request): string {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.user.id;
}

function boardIdOf(req: Request): string {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership.boardId;
}

export const create: RequestHandler = async (req, res) => {
  const column = await columnService.createColumn(boardIdOf(req), userIdOf(req), req.body as CreateColumnInput);
  broadcast(req, boardIdOf(req), "column:created", { column, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(201).json({ success: true, data: { column } });
};

export const rename: RequestHandler = async (req, res) => {
  const column = await columnService.renameColumn(boardIdOf(req), String(req.params.columnId), userIdOf(req), req.body as UpdateColumnInput);
  broadcast(req, boardIdOf(req), "column:updated", { column, actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: { column } });
};

export const remove: RequestHandler = async (req, res) => {
  await columnService.deleteColumn(boardIdOf(req), String(req.params.columnId), userIdOf(req));
  broadcast(req, boardIdOf(req), "column:deleted", { columnId: String(req.params.columnId), actorId: userIdOf(req) });
  flushActivity(boardIdOf(req));
  res.status(200).json({ success: true, data: null });
};

export const reorder: RequestHandler = async (req, res) => {
  const { columnIds } = req.body as ReorderColumnsInput;
  const columns = await columnService.reorderColumns(boardIdOf(req), columnIds);
  broadcast(req, boardIdOf(req), "column:reordered", { columns, actorId: userIdOf(req) });
  res.status(200).json({ success: true, data: { columns } });
};
