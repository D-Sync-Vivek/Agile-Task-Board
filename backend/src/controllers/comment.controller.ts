import type { Request, RequestHandler } from "express";
import * as commentService from "../services/comment.service";
import type { CommentActor } from "../services/comment.service";
import { AppError } from "../utils/AppError";
import type { CreateCommentInput, UpdateCommentInput } from "../validators/comment.validator";

// Handlers run behind requireAuth + requireBoardPermission (req.user, req.boardMembership).
function actorOf(req: Request): CommentActor {
  if (!req.user || !req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return { userId: req.user.id, role: req.boardMembership.role };
}

export const list: RequestHandler = async (req, res) => {
  const comments = await commentService.listComments(String(req.params.taskId));
  res.status(200).json({ success: true, data: { comments } });
};

export const create: RequestHandler = async (req, res) => {
  const comment = await commentService.createComment(String(req.params.taskId), actorOf(req).userId, req.body as CreateCommentInput);
  res.status(201).json({ success: true, data: { comment } });
};

export const update: RequestHandler = async (req, res) => {
  const comment = await commentService.updateComment(String(req.params.commentId), actorOf(req), req.body as UpdateCommentInput);
  res.status(200).json({ success: true, data: { comment } });
};

export const remove: RequestHandler = async (req, res) => {
  await commentService.deleteComment(String(req.params.commentId), actorOf(req));
  res.status(200).json({ success: true, data: null });
};
