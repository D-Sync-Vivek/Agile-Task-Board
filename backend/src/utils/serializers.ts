import type { TaskPriority } from "../generated/prisma/client";

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
