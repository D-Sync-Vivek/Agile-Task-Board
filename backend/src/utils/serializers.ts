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
