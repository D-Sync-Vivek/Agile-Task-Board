import type { TaskPriority } from "../generated/prisma/client";

/** The columns of a task that are exposed through the API (single definition, shared by every task query). */
export const taskSelect = {
  id: true,
  boardId: true,
  columnId: true,
  title: true,
  description: true,
  priority: true,
  assigneeId: true,
  createdById: true,
  position: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface TaskRow {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string;
  position: number;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** API shape of a task. dueDate is a calendar date ("YYYY-MM-DD"), not a timestamp. */
export function toTaskDto(task: TaskRow) {
  return { ...task, dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null };
}

/** The comment author's public info: no email, nothing sensitive. */
export const commentSelect = {
  id: true,
  taskId: true,
  userId: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, avatar: true } },
} as const;

interface CommentRow {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; avatar: string | null };
}

/** API shape of a comment. `edited` is true once the text has been changed after posting. */
export function toCommentDto(comment: CommentRow) {
  const { user, ...rest } = comment;
  return { ...rest, author: user, edited: comment.updatedAt.getTime() > comment.createdAt.getTime() };
}
