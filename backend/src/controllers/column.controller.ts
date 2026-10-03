import type { Request, RequestHandler } from "express";
import * as columnService from "../services/column.service";
import { AppError } from "../utils/AppError";
import type { CreateColumnInput, ReorderColumnsInput, UpdateColumnInput } from "../validators/column.validator";

// All handlers run behind requireAuth + requireBoardPermission, which set req.boardMembership.
function boardIdOf(req: Request): string {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership.boardId;
}

export const create: RequestHandler = async (req, res) => {
  const column = await columnService.createColumn(boardIdOf(req), req.body as CreateColumnInput);
  res.status(201).json({ success: true, data: { column } });
};

export const rename: RequestHandler = async (req, res) => {
  const column = await columnService.renameColumn(String(req.params.columnId), req.body as UpdateColumnInput);
  res.status(200).json({ success: true, data: { column } });
};

export const remove: RequestHandler = async (req, res) => {
  await columnService.deleteColumn(boardIdOf(req), String(req.params.columnId));
  res.status(200).json({ success: true, data: null });
};

export const reorder: RequestHandler = async (req, res) => {
  const { columnIds } = req.body as ReorderColumnsInput;
  const columns = await columnService.reorderColumns(boardIdOf(req), columnIds);
  res.status(200).json({ success: true, data: { columns } });
};
