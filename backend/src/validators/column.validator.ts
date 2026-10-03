import { z } from "zod";

const title = z.string().trim().min(1, "Column title is required").max(100, "Column title must be at most 100 characters");

export const createColumnSchema = z.object({ title });

export const updateColumnSchema = z.object({ title }); // position is changed only through the reorder endpoint

export const reorderColumnsSchema = z.object({
  // The complete list of the board's column ids in the desired left-to-right order.
  columnIds: z
    .array(z.string().min(1).max(64))
    .min(1, "columnIds must contain at least one column")
    .max(500, "Too many columns")
    .refine((ids) => new Set(ids).size === ids.length, "columnIds must not contain duplicates"),
});

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type ReorderColumnsInput = z.infer<typeof reorderColumnsSchema>;
