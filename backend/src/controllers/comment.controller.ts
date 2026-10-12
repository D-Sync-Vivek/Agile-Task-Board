import type { Request, RequestHandler } from "express";
import * as commentService from "../services/comment.service";
import type { CommentActor } from "../services/comment.service";
import { broadcast, flushActivity } from "../sockets/realtime";
import { AppError } from "../utils/AppError";
import type { CreateCommentInput, UpdateCommentInput } from "../validators/comment.validator";

// Handlers run behind requireAuth + requireBoardPermission (req.user, req.boardMembership).
function actorOf(req: Request): CommentActor {
  if (!req.user || !req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return { userId: req.user.id, role: req.boardMembership.role };
}

function boardIdOf(req: Request): string {
  if (!req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.boardMembership.boardId;
}

export const list: RequestHandler = async (req, res) => {
  const comments = await commentService.listComments(String(req.params.taskId));
  res.status(200).json({ success: true, data: { comments } });
};

export const create: RequestHandler = async (req, res) => {
  const comment = await commentService.createComment(String(req.params.taskId), actorOf(req).userId, req.body as CreateCommentInput);
  broadcast(req, boardIdOf(req), "comment:created", { comment, taskId: comment.taskId, actorId: actorOf(req).userId });
  flushActivity(boardIdOf(req));
  res.status(201).json({ success: true, data: { comment } });
};

export const update: RequestHandler = async (req, res) => {
  const comment = await commentService.updateComment(String(req.params.commentId), actorOf(req), req.body as UpdateCommentInput);
  broadcast(req, boardIdOf(req), "comment:updated", { comment, taskId: comment.taskId, actorId: actorOf(req).userId });
  res.status(200).json({ success: true, data: { comment } });
};

export const remove: RequestHandler = async (req, res) => {
  const deleted = await commentService.deleteComment(String(req.params.commentId), actorOf(req));
  if (deleted) broadcast(req, boardIdOf(req), "comment:deleted", { commentId: String(req.params.commentId), taskId: deleted.taskId, actorId: actorOf(req).userId });
  res.status(200).json({ success: true, data: null });
};
