import { roleHasPermission } from "../config/permissions";
import { prisma } from "../config/prisma";
import type { BoardRole } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";
import { isPrismaError } from "../utils/prismaErrors";
import { commentSelect, toCommentDto } from "../utils/serializers";
import type { CreateCommentInput, UpdateCommentInput } from "../validators/comment.validator";
import { recordActivity } from "./activity.service";
import { taskNotFound } from "./task.service";

export const commentNotFound = () => new AppError(404, "COMMENT_NOT_FOUND", "Comment not found");

/** The person making the request and their role on the comment's board (set by requireBoardPermission). */
export interface CommentActor {
  userId: string;
  role: BoardRole;
}

/** For requireBoardPermission: which board owns this comment (via its task)? undefined if there is no such comment. */
export async function resolveCommentBoardId(commentId: string): Promise<string | undefined> {
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { task: { select: { boardId: true } } } });
  return comment?.task.boardId;
}

/** Oldest first, like a conversation. */
export async function listComments(taskId: string) {
  const comments = await prisma.comment.findMany({
    where: { taskId },
    select: commentSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return comments.map(toCommentDto);
}

export async function createComment(taskId: string, userId: string, input: CreateCommentInput) {
  // Both timestamps come from the same clock, so "edited" (updatedAt > createdAt) can't be triggered by clock
  // differences between this server and the database.
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId }, select: { boardId: true, title: true } });
      if (!task) throw taskNotFound(); // deleted after the permission check

      const comment = await tx.comment.create({
        data: { taskId, userId, content: input.content, createdAt: now, updatedAt: now },
        select: commentSelect,
      });
      await recordActivity(tx, {
        boardId: task.boardId,
        userId,
        action: "COMMENT_ADDED",
        entityId: comment.id,
        metadata: { taskId, taskTitle: task.title },
      });
      return toCommentDto(comment);
    });
  } catch (error) {
    if (isPrismaError(error, "P2003")) throw taskNotFound(); // deleted between the lookup and the insert
    throw error;
  }
}

/** Only the author may edit (the route already checked they can still comment). */
export async function updateComment(commentId: string, actor: CommentActor, input: UpdateCommentInput) {
  const existing = await prisma.comment.findUnique({ where: { id: commentId }, select: { userId: true } });
  if (!existing) throw commentNotFound();
  if (existing.userId !== actor.userId) {
    throw new AppError(403, "FORBIDDEN", "You can only edit your own comments");
  }
  try {
    const comment = await prisma.comment.update({ where: { id: commentId }, data: { content: input.content }, select: commentSelect });
    return toCommentDto(comment);
  } catch (error) {
    if (isPrismaError(error, "P2025")) throw commentNotFound();
    throw error;
  }
}

/** The author can always remove their own comment; board moderators (OWNER/ADMIN) can remove anyone's. */
export async function deleteComment(commentId: string, actor: CommentActor): Promise<void> {
  const existing = await prisma.comment.findUnique({ where: { id: commentId }, select: { userId: true } });
  if (!existing) throw commentNotFound();
  if (existing.userId !== actor.userId && !roleHasPermission(actor.role, "comment:moderate")) {
    throw new AppError(403, "FORBIDDEN", "You can only delete your own comments");
  }
  try {
    await prisma.comment.delete({ where: { id: commentId } });
  } catch (error) {
    if (isPrismaError(error, "P2025")) return; // already gone: the goal is met
    throw error;
  }
}
