import type { Request, RequestHandler } from "express";
import * as boardService from "../services/board.service";
import { AppError } from "../utils/AppError";
import type { CreateBoardInput, UpdateBoardInput } from "../validators/board.validator";

// Handlers below run behind requireAuth (req.user) and, for /:boardId routes, requireBoardPermission (req.boardMembership).
function currentUserId(req: Request): string {
  if (!req.user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.user.id;
}

function currentMembership(req: Request) {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership;
}

export const list: RequestHandler = async (req, res) => {
  const boards = await boardService.listBoards(currentUserId(req));
  res.status(200).json({ success: true, data: { boards } });
};

export const create: RequestHandler = async (req, res) => {
  const board = await boardService.createBoard(currentUserId(req), req.body as CreateBoardInput);
  res.status(201).json({ success: true, data: { board } });
};

export const get: RequestHandler = async (req, res) => {
  const { boardId, role } = currentMembership(req);
  const board = await boardService.getBoardDetail(boardId, role);
  res.status(200).json({ success: true, data: { board } });
};

export const update: RequestHandler = async (req, res) => {
  const { boardId, role } = currentMembership(req);
  const board = await boardService.updateBoard(boardId, req.body as UpdateBoardInput, role);
  res.status(200).json({ success: true, data: { board } });
};

export const remove: RequestHandler = async (req, res) => {
  await boardService.deleteBoard(currentMembership(req).boardId);
  res.status(200).json({ success: true, data: null });
};
