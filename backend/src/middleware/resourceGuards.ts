import type { RequestHandler } from "express";
import type { Permission } from "../config/permissions";
import { commentNotFound, resolveCommentBoardId } from "../services/comment.service";
import { columnNotFound, resolveColumnBoardId } from "../services/column.service";
import { resolveTaskBoardId, taskNotFound } from "../services/task.service";
import { requireBoardPermission } from "./requireBoardPermission";

/**
 * Guards for routes addressed by a CHILD id (/tasks/:taskId, /columns/:columnId, /comments/:commentId).
 * Each looks up the owning board, checks the caller's permission there, and answers "no such thing" and
 * "not your board" with the identical 404 so ids can't be probed.
 */
export const forTask = (permission: Permission): RequestHandler =>
  requireBoardPermission(permission, { getBoardId: (req) => resolveTaskBoardId(String(req.params.taskId)), notFound: taskNotFound });

export const forColumn = (permission: Permission): RequestHandler =>
  requireBoardPermission(permission, { getBoardId: (req) => resolveColumnBoardId(String(req.params.columnId)), notFound: columnNotFound });

export const forComment = (permission: Permission): RequestHandler =>
  requireBoardPermission(permission, { getBoardId: (req) => resolveCommentBoardId(String(req.params.commentId)), notFound: commentNotFound });
