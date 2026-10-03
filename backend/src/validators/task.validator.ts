import { z } from "zod";

const id = z.string().min(1).max(64);

const title = z.string().trim().min(1, "Task title is required").max(200, "Task title must be at most 200 characters");

// Blank description is stored as null.
const description = z
  .string()
  .trim()
  .max(10000, "Description must be at most 10000 characters")
  .transform((v) => (v === "" ? null : v))
  .nullable();

const priority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

/** Calendar date "YYYY-MM-DD" that really exists (rejects 2026-02-30). */
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a valid calendar date")
  .nullable();

export const createTaskSchema = z.object({
  title,
  columnId: id,
  description: description.optional(),
  priority: priority.optional(),
  assigneeId: id.nullable().optional(),
  dueDate: dueDate.optional(),
});

// columnId/position change only through /move, the assignee only through /assign (one way to do each thing).
export const updateTaskSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    priority: priority.optional(),
    dueDate: dueDate.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update (title, description, priority or dueDate)",
  });

export const moveTaskSchema = z.object({
  columnId: id,
  // 0-based index in the destination column. Values past the end are clamped to "last".
  position: z.number().int("position must be an integer").min(0, "position must be 0 or greater").max(100_000),
});

export const assignTaskSchema = z.object({
  assigneeId: id.nullable(), // null = unassign
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
